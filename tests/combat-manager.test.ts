// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppDatabase,
  SQLiteDataManager,
  createDefaultToolPluginManager
} from '../src/index.js';

class QueueJsonProvider {
  constructor(responses = []) {
    this.responses = [...responses];
    this.calls = [];
  }

  async generate(request) {
    this.calls.push(request);
    const response = this.responses.shift() || {};
    return {
      content: JSON.stringify(response),
      raw: { provider: 'queue-json-test' }
    };
  }
}

function createTestChat() {
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
  const character = appDatabase.importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Combat GM',
      first_mes: 'Begin.'
    }
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Combat Test',
    includeGreeting: false
  }).session;
  return { appDatabase, chat };
}

async function seedActors(tools, chatId) {
  await tools.executeTool('system.npc_state.patch_state', {
    chatSessionId: chatId,
    sceneId: 'arena',
    npcId: 'pc_arin',
    actorType: 'player',
    isPlayer: true,
    name: 'Arin',
    values: { hp: 10, maxHp: 10, speed: 30 }
  });
  await tools.executeTool('system.npc_state.patch_state', {
    chatSessionId: chatId,
    sceneId: 'arena',
    npcId: 'npc_guard',
    actorType: 'npc',
    name: 'Guard',
    values: { hp: 12, maxHp: 12 }
  });
  await tools.executeTool('system.resources.reset_action_economy', {
    chatSessionId: chatId,
    sceneId: 'arena',
    npcId: 'pc_arin',
    movementMax: 30
  });
}

test('combat module can use LLM only to judge battle start and then stores battle records', async () => {
  const { appDatabase, chat } = createTestChat();
  const provider = new QueueJsonProvider([{
    status: 'judged',
    shouldStartBattle: true,
    battleName: 'Gate Skirmish',
    reason: 'The guard draws steel and blocks escape.',
    participantIds: ['pc_arin', 'npc_guard'],
    allyIds: ['pc_arin'],
    enemyIds: ['npc_guard'],
    objective: 'Defeat, disarm, or force the guard to yield.',
    stakes: 'The alarm may spread if the fight drags on.'
  }]);
  const tools = createDefaultToolPluginManager({ appDatabase, chatProvider: provider, trace: false });

  try {
    const started = await tools.executeTool('system.combat.start_battle', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      sourceText: '守卫拔剑冲过来。',
      useLlm: true
    });

    assert.equal(provider.calls.length, 1);
    assert.equal(started.output.battle.data.name, 'Gate Skirmish');
    assert.equal(started.output.battle.data.status, 'active');
    assert.deepEqual(started.output.battle.data.enemyIds, ['npc_guard']);
    assert.equal(started.output.event.data.eventType, 'start');
  } finally {
    appDatabase.close();
  }
});

test('combat resolve_action handles normal combat without LLM and spends resources after resolution', async () => {
  const { appDatabase, chat } = createTestChat();
  const provider = new QueueJsonProvider();
  const tools = createDefaultToolPluginManager({ appDatabase, chatProvider: provider, trace: false });

  try {
    await seedActors(tools, chat.id);
    const battle = await tools.executeTool('system.combat.start_battle', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      battleId: 'battle_arena',
      name: 'Arena Fight',
      participantIds: ['pc_arin', 'npc_guard'],
      allyIds: ['pc_arin'],
      enemyIds: ['npc_guard']
    });

    const action = await tools.executeTool('system.combat.resolve_action', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      battleId: battle.output.battle.data.battleId,
      actorId: 'pc_arin',
      targetId: 'npc_guard',
      hitResult: { outcome: 'hit', hit: true },
      damage: [{ type: 'slashing', amount: 5 }]
    });

    assert.equal(provider.calls.length, 0);
    assert.equal(action.output.ok, true);
    assert.equal(action.output.llmUsed, false);
    assert.equal(action.output.settlement.records[0].data.values.hp, 7);
    assert.equal(action.output.event.data.eventType, 'action');

    const resources = await tools.executeTool('system.resources.get_actor_resources', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      npcId: 'pc_arin'
    });
    assert.equal(resources.output.snapshot.actionEconomy.action.current, 0);
  } finally {
    appDatabase.close();
  }
});

test('combat prepare_battle creates missing enemies with default attacks and rewards update inventory', async () => {
  const { appDatabase, chat } = createTestChat();
  const provider = new QueueJsonProvider();
  const tools = createDefaultToolPluginManager({ appDatabase, chatProvider: provider, trace: false });

  try {
    const preview = await tools.executeTool('system.combat.prepare_battle', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      actorId: 'pc_arin',
      actorName: 'Arin',
      sourceText: '我打两只妖兽。',
      dryRun: true
    });
    assert.equal(preview.output.status, 'dry_run');
    assert.equal(preview.output.enemyIds.length, 2);
    assert.equal(preview.output.enemies[0].skillBar.actions.length, 1);
    assert.equal(preview.output.enemies[0].combatMechanics.skills[0].metadata.combatAction.mode, 'attack');
    assert.equal(provider.calls.length, 0);

    const prepared = await tools.executeTool('system.combat.prepare_battle', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      actorId: 'pc_arin',
      actorName: 'Arin',
      sourceText: '我打两只妖兽。'
    });
    assert.equal(prepared.output.status, 'prepared');
    assert.equal(prepared.output.battle.data.enemyIds.length, 2);
    assert.equal(prepared.output.battle.data.participantIds.length, 3);

    const firstEnemy = await tools.executeTool('system.npc_state.get_state', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      npcId: prepared.output.battle.data.enemyIds[0]
    });
    assert.equal(firstEnemy.output.data.skillBar.actions[0].mechanicKind, 'skill');

    const ended = await tools.executeTool('system.combat.end_battle', {
      chatSessionId: chat.id,
      battleId: prepared.output.battle.data.battleId,
      outcome: 'won',
      rewardActorId: 'pc_arin',
      rewards: [{ id: 'spirit_stone', name: '灵石', quantity: 2 }]
    });
    assert.equal(ended.output.rewardApplication.status, 'applied');

    const player = await tools.executeTool('system.npc_state.get_state', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      npcId: 'pc_arin'
    });
    assert.equal(player.output.data.inventory.items.find((item) => item.id === 'spirit_stone').quantity, 2);

    const elitePrepared = await tools.executeTool('system.combat.prepare_battle', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      actorId: 'pc_arin',
      actorName: 'Arin',
      sourceText: '我挑战一只高阶魔兽。'
    });
    assert.equal(elitePrepared.output.status, 'prepared');
    assert.equal(elitePrepared.output.battle.data.enemyIds.length, 1);

    const eliteEnded = await tools.executeTool('system.combat.end_battle', {
      chatSessionId: chat.id,
      battleId: elitePrepared.output.battle.data.battleId,
      outcome: 'won',
      rewardActorId: 'pc_arin'
    });
    assert.equal(eliteEnded.output.rewardApplication.status, 'applied');
    assert.equal(eliteEnded.output.rewardApplication.rewards.some((item) => item.id === 'high_grade_demon_beast_material'), true);

    const rewardedPlayer = await tools.executeTool('system.npc_state.get_state', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      npcId: 'pc_arin'
    });
    assert.equal(rewardedPlayer.output.data.inventory.items.find((item) => item.id === 'high_grade_demon_beast_material').quantity, 2);
  } finally {
    appDatabase.close();
  }
});

test('special combat judgement consumes no resources and aftermath planning is LLM-only boundary', async () => {
  const { appDatabase, chat } = createTestChat();
  const provider = new QueueJsonProvider([
    {
      status: 'judged',
      actionText: '我在战斗中亲了守卫一口。',
      actionMode: 'persuasion',
      consumesResourcesAfterResolution: true,
      resourceCosts: [{ kind: 'actionEconomy', resource: 'action', amount: 1 }],
      summary: 'Route this through persuasion or action resolver; do not spend resources until the ruling resolves.'
    },
    {
      status: 'planned',
      outcome: 'won',
      rewardPlan: { rewards: [{ kind: 'loot', summary: 'guard key' }] },
      influencePlan: { npcUpdates: [{ npcId: 'npc_guard', summary: 'humiliated but alive' }] },
      narrativeSummary: 'The fight ends with the guard disarmed.'
    }
  ]);
  const tools = createDefaultToolPluginManager({ appDatabase, chatProvider: provider, trace: false });

  try {
    await seedActors(tools, chat.id);
    await tools.executeTool('system.combat.start_battle', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      battleId: 'battle_special',
      name: 'Special Fight',
      participantIds: ['pc_arin', 'npc_guard'],
      allyIds: ['pc_arin'],
      enemyIds: ['npc_guard']
    });

    const special = await tools.executeTool('system.combat.judge_special_action', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      battleId: 'battle_special',
      actorId: 'pc_arin',
      targetId: 'npc_guard',
      sourceText: '我在战斗中亲了守卫一口。',
      useLlm: true
    });
    assert.equal(special.output.judgement.actionMode, 'persuasion');

    const resources = await tools.executeTool('system.resources.get_actor_resources', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      npcId: 'pc_arin'
    });
    assert.equal(resources.output.snapshot.actionEconomy.action.current, 1);

    const ended = await tools.executeTool('system.combat.end_battle', {
      chatSessionId: chat.id,
      battleId: 'battle_special',
      outcome: 'won',
      sourceText: '守卫被缴械。',
      useLlm: true
    });
    assert.equal(ended.output.battle.data.status, 'won');
    assert.equal(ended.output.aftermath.rewardPlan.rewards[0].summary, 'guard key');
    assert.equal(provider.calls.length, 2);

    const defaultTools = createDefaultToolPluginManager({ appDatabase, trace: false });
    assert.equal(defaultTools.getTool('system.combat.resolve_action').id, 'system.combat.resolve_action');
    assert.equal(defaultTools.getTool('system.combat.judge_special_action').pluginId, 'system.combat');
  } finally {
    appDatabase.close();
  }
});

test('combat hidden action table uses only attack defense dodge and can be debug-selected', async () => {
  const { appDatabase, chat } = createTestChat();
  const tools = createDefaultToolPluginManager({ appDatabase, trace: false });

  try {
    const reference = await tools.executeTool('system.combat.describe_action_table_reference', {});
    assert.deepEqual(reference.output.allowedModes, ['attack', 'defense', 'dodge']);
    assert.match(reference.output.reference.purpose, /Hidden enemy action policy/);

    const prompt = await tools.executeTool('system.combat.build_action_table_prompt', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      enemy: {
        actorId: 'npc_minor_god',
        description: 'A bored minor god playing with mortals.'
      },
      settingText: '这个敌人不是杂鱼，而是能扭曲局部现实的古老神性存在。',
      userReference: '古神级敌人的攻击修正可以超过普通人类，但仍然只输出 attack/defense/dodge。'
    });
    assert.match(prompt.output.prompt, /attack, defense, and dodge/);
    assert.match(prompt.output.prompt, /Do not create named skills/);

    const normalized = await tools.executeTool('system.combat.normalize_action_table', {
      actorId: 'npc_minor_god',
      threatTier: 'ancient_god',
      weights: { attack: 80, defense: 18, dodge: 2 },
      attack: {
        modifier: 18,
        damageRolls: [{ type: 'reality', diceCount: 8, diceSides: 12, modifier: 20 }]
      },
      defense: { acBonus: 8, temporaryHp: 80 },
      dodge: { acBonus: 10 }
    });
    assert.equal(normalized.output.actionTable.actorId, 'npc_minor_god');
    assert.deepEqual(Object.keys(normalized.output.actionTable.weights), ['attack', 'defense', 'dodge']);
    assert.equal(normalized.output.actionTable.attack.modifier, 18);

    const attack = await tools.executeTool('system.combat.select_action_from_table', {
      table: normalized.output.actionTable,
      roll: 0.1
    });
    assert.equal(attack.output.selected.mode, 'attack');

    const defense = await tools.executeTool('system.combat.select_action_from_table', {
      table: normalized.output.actionTable,
      roll: 0.85
    });
    assert.equal(defense.output.selected.mode, 'defense');

    const dodge = await tools.executeTool('system.combat.select_action_from_table', {
      table: normalized.output.actionTable,
      roll: 0.99
    });
    assert.equal(dodge.output.selected.mode, 'dodge');
    assert.equal(dodge.output.noLlm, true);
  } finally {
    appDatabase.close();
  }
});

test('combat enemy object can be spawned and ordinary enemy turns resolve without LLM', async () => {
  const { appDatabase, chat } = createTestChat();
  const provider = new QueueJsonProvider();
  const tools = createDefaultToolPluginManager({ appDatabase, chatProvider: provider, trace: false });

  try {
    await seedActors(tools, chat.id);
    await tools.executeTool('system.combat.start_battle', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      battleId: 'battle_numeric_enemy',
      name: 'Numeric Enemy Battle',
      participantIds: ['pc_arin', 'npc_goblin'],
      allyIds: ['pc_arin'],
      enemyIds: ['npc_goblin']
    });

    const prompt = await tools.executeTool('system.combat.build_enemy_object_prompt', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      settingText: '一个普通哥布林伏击玩家。',
      userReference: '普通杂鱼应该有较低生命值和较低攻击修正。'
    });
    assert.match(prompt.output.prompt, /ordinary battle must run without AI/);

    const spawned = await tools.executeTool('system.combat.spawn_combatant', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      battleId: 'battle_numeric_enemy',
      enemyObject: {
        enemyId: 'npc_goblin',
        name: 'Goblin',
        threatTier: 'minion',
        values: { hp: 8, maxHp: 8, armorClass: 12, speed: 30 },
        normalActionPolicy: {
          actorId: 'npc_goblin',
          weights: { attack: 100, defense: 0, dodge: 0 },
          attack: {
            successThreshold: -100,
            modifier: 3,
            damage: [{ type: 'piercing', amount: 3 }]
          }
        }
      }
    });
    assert.equal(spawned.output.enemy.enemyId, 'npc_goblin');
    assert.equal(spawned.output.state.record.data.values.hp, 8);

    const turn = await tools.executeTool('system.combat.resolve_enemy_turn', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      battleId: 'battle_numeric_enemy',
      actorId: 'npc_goblin',
      targetId: 'pc_arin',
      roll: 0.01,
      forceMode: 'success'
    });
    assert.equal(provider.calls.length, 0);
    assert.equal(turn.output.ordinaryAction.selected.mode, 'attack');
    assert.equal(turn.output.actionResult.llmUsed, false);
    assert.equal(turn.output.actionResult.settlement.records[0].data.values.hp, 7);

    await tools.executeTool('system.resources.reset_action_economy', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      npcId: 'npc_goblin'
    });
    const defense = await tools.executeTool('system.combat.resolve_enemy_turn', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      battleId: 'battle_numeric_enemy',
      actorId: 'npc_goblin',
      normalActionPolicy: {
        actorId: 'npc_goblin',
        weights: { attack: 0, defense: 100, dodge: 0 },
        defense: { acBonus: 2, temporaryHp: 2, durationRounds: 1 }
      },
      roll: 0.2
    });
    assert.equal(defense.output.ordinaryAction.selected.mode, 'defense');
    assert.equal(defense.output.settlement.records[0].data.specialStatuses.find((status) => status.id === 'defending').remainingTurns, 1);
    assert.equal(defense.output.statePatchResult.record.data.statusBar.combatModifiers.defending.acBonus, 2);

    const summary = await tools.executeTool('system.combat.summarize_battle_result', {
      chatSessionId: chat.id,
      battleId: 'battle_numeric_enemy'
    });
    assert.equal(summary.output.summary.llmUsedForOrdinaryCombat, false);
    assert.match(summary.output.aiContext, /resolved numerically without LLM/);
  } finally {
    appDatabase.close();
  }
});

test('combat generated enemy object writes mechanics registry refs for no-LLM action selection', async () => {
  const { appDatabase, chat } = createTestChat();
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const provider = new QueueJsonProvider();
  const tools = createDefaultToolPluginManager({ appDatabase, dataManager, chatProvider: provider, trace: false });

  try {
    await seedActors(tools, chat.id);
    await tools.executeTool('system.combat.start_battle', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      battleId: 'battle_generated_enemy',
      name: 'Generated Enemy',
      participantIds: ['pc_arin', 'npc_generated_wight'],
      allyIds: ['pc_arin'],
      enemyIds: ['npc_generated_wight']
    });

    const spawned = await tools.executeTool('system.combat.spawn_combatant', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      battleId: 'battle_generated_enemy',
      enemyObject: {
        enemyId: 'npc_generated_wight',
        name: 'Generated Wight',
        threatTier: 'debug_standard',
        values: { hp: 18, maxHp: 18, armorClass: 13, speed: 30 },
        combatMechanics: {
          skills: [{
            id: 'skill_generated_claw',
            name: 'Generated Claw',
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
            id: 'feat_generated_guard',
            name: 'Generated Guard',
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
            id: 'status_generated_evasion',
            name: 'Generated Evasion',
            category: 'combat',
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
        }
      }
    });

    assert.equal(provider.calls.length, 0);
    assert.equal(spawned.output.mechanicWrites.length, 3);
    assert.equal(spawned.output.state.record.data.skillBar.actions[0].skillId, 'skill_generated_claw');
    assert.deepEqual(spawned.output.state.record.data.resources.combat.featIds, ['feat_generated_guard']);
    assert.deepEqual(spawned.output.state.record.data.resources.combat.statusIds, ['status_generated_evasion']);

    const registeredSkill = await tools.executeTool('system.mechanics_registry.get_skill', { id: 'skill_generated_claw' });
    assert.equal(registeredSkill.output.data.metadata.combatAction.damage[0].amount, 3);

    const selected = await tools.executeTool('system.combat.select_enemy_action', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      battleId: 'battle_generated_enemy',
      actorId: 'npc_generated_wight',
      targetId: 'pc_arin',
      roll: 0.95
    });
    assert.equal(selected.output.selectionSource, 'actor_state_and_mechanics');
    assert.equal(selected.output.mechanics.length, 3);
    assert.equal(selected.output.selected.mode, 'dodge');
    assert.equal(selected.output.selected.mechanic.id, 'status_generated_evasion');

    const turn = await tools.executeTool('system.combat.resolve_enemy_turn', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      battleId: 'battle_generated_enemy',
      actorId: 'npc_generated_wight',
      targetId: 'pc_arin',
      roll: 0.75
    });
    assert.equal(turn.output.ordinaryAction.selected.mode, 'defense');
    assert.equal(turn.output.settlement.records[0].data.values.temporaryHp, 2);
  } finally {
    dataManager.close();
    appDatabase.close();
  }
});

test('combat enemy action selector reads actor state and mechanics registry before resolving no-LLM enemy turns', async () => {
  const { appDatabase, chat } = createTestChat();
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const provider = new QueueJsonProvider();
  const tools = createDefaultToolPluginManager({ appDatabase, dataManager, chatProvider: provider, trace: false });

  try {
    await tools.executeTool('system.mechanics_registry.upsert_skill', {
      id: 'skill_shadow_claw',
      name: 'Shadow Claw',
      category: 'combat',
      numericValues: { weight: 70 },
      metadata: {
        combatAction: {
          mode: 'attack',
          weight: 70,
          modifier: 5,
          damage: [{ type: 'necrotic', amount: 4 }]
        }
      }
    }, undefined, { authorization: true });
    await tools.executeTool('system.mechanics_registry.upsert_feat', {
      id: 'feat_guarded_recovery',
      name: 'Guarded Recovery',
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
    }, undefined, { authorization: true });
    await tools.executeTool('system.mechanics_registry.upsert_status', {
      id: 'status_cornered',
      name: 'Cornered',
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
    }, undefined, { authorization: true });

    await seedActors(tools, chat.id);
    await tools.executeTool('system.npc_state.patch_state', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      npcId: 'npc_guard',
      skillBar: {
        actions: [
          { id: 'skill_shadow_claw', name: 'Shadow Claw', mechanicKind: 'skill', skillId: 'skill_shadow_claw' }
        ]
      },
      resources: {
        combat: {
          featIds: ['feat_guarded_recovery']
        }
      },
      specialStatuses: [
        { id: 'status_cornered', name: 'Cornered', active: true }
      ]
    });
    await tools.executeTool('system.resources.reset_action_economy', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      npcId: 'npc_guard',
      movementMax: 30
    });
    await tools.executeTool('system.combat.start_battle', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      battleId: 'battle_enemy_selector',
      name: 'Enemy Selector',
      participantIds: ['pc_arin', 'npc_guard'],
      allyIds: ['pc_arin'],
      enemyIds: ['npc_guard']
    });

    const selected = await tools.executeTool('system.combat.select_enemy_action', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      battleId: 'battle_enemy_selector',
      actorId: 'npc_guard',
      targetId: 'pc_arin',
      roll: 0.75
    });
    assert.equal(provider.calls.length, 0);
    assert.equal(selected.output.selectionSource, 'actor_state_and_mechanics');
    assert.equal(selected.output.mechanics.length, 3);
    assert.equal(selected.output.selected.mode, 'defense');
    assert.equal(selected.output.selected.mechanic.id, 'feat_guarded_recovery');

    const turn = await tools.executeTool('system.combat.resolve_enemy_turn', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      battleId: 'battle_enemy_selector',
      actorId: 'npc_guard',
      targetId: 'pc_arin',
      roll: 0.75
    });
    assert.equal(turn.output.ordinaryAction.selected.mode, 'defense');
    assert.equal(turn.output.llmUsed, false);
    assert.equal(turn.output.settlement.records[0].data.values.temporaryHp, 2);
    assert.equal(turn.output.statePatchResult.record.data.statusBar.combatModifiers.defending.acBonus, 2);

    const dodge = await tools.executeTool('system.combat.select_enemy_action', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      battleId: 'battle_enemy_selector',
      actorId: 'npc_guard',
      targetId: 'pc_arin',
      roll: 0.95
    });
    assert.equal(dodge.output.selected.mode, 'dodge');
    assert.equal(dodge.output.selected.mechanic.id, 'status_cornered');
    assert.equal(dodge.output.candidates.some((candidate) => candidate.actionId === 'defending'), false);
  } finally {
    dataManager.close();
    appDatabase.close();
  }
});

test('combat player action selector lists database-backed choices and builds resolve_action input', async () => {
  const { appDatabase, chat } = createTestChat();
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const provider = new QueueJsonProvider();
  const tools = createDefaultToolPluginManager({ appDatabase, dataManager, chatProvider: provider, trace: false });

  try {
    await tools.executeTool('system.mechanics_registry.upsert_skill', {
      id: 'skill_precise_thrust',
      name: 'Precise Thrust',
      category: 'combat',
      metadata: {
        combatAction: {
          actionKind: 'attack',
          modifier: 6,
          damage: [{ type: 'piercing', amount: 6 }]
        }
      }
    }, undefined, { authorization: true });
    await seedActors(tools, chat.id);
    await tools.executeTool('system.npc_state.patch_state', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      npcId: 'pc_arin',
      skillBar: {
        actions: [
          { id: 'skill_precise_thrust', name: 'Precise Thrust', mechanicKind: 'skill', skillId: 'skill_precise_thrust' }
        ]
      }
    });
    await tools.executeTool('system.combat.start_battle', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      battleId: 'battle_player_selector',
      name: 'Player Selector',
      participantIds: ['pc_arin', 'npc_guard'],
      allyIds: ['pc_arin'],
      enemyIds: ['npc_guard']
    });

    const listed = await tools.executeTool('system.combat.list_player_actions', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      battleId: 'battle_player_selector',
      actorId: 'pc_arin',
      targetId: 'npc_guard'
    });
    assert.equal(provider.calls.length, 0);
    assert.equal(listed.output.mechanics.length, 1);
    assert.ok(listed.output.choices.some((choice) => choice.actionId === 'skill_precise_thrust'));

    const built = await tools.executeTool('system.combat.build_player_action', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      battleId: 'battle_player_selector',
      actorId: 'pc_arin',
      targetId: 'npc_guard',
      selectedActionId: 'skill_precise_thrust',
      hitResult: { outcome: 'hit', hit: true, total: 18, successThreshold: 12 }
    });
    assert.equal(built.output.noLlm, true);
    assert.equal(built.output.selected.mechanic.id, 'skill_precise_thrust');
    assert.deepEqual(built.output.resolveActionInput.damage, [{ type: 'piercing', amount: 6 }]);

    const action = await tools.executeTool('system.combat.resolve_action', built.output.resolveActionInput);
    assert.equal(action.output.llmUsed, false);
    assert.equal(action.output.settlement.records[0].data.values.hp, 6);
  } finally {
    dataManager.close();
    appDatabase.close();
  }
});

test('combat resolve_action applies modifier resolver buffs, target defenses, and expiring self buffs', async () => {
  const { appDatabase, chat } = createTestChat();
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const provider = new QueueJsonProvider();
  const tools = createDefaultToolPluginManager({ appDatabase, dataManager, chatProvider: provider, trace: false });

  try {
    await tools.executeTool('system.mechanics_registry.upsert_skill', {
      id: 'skill_guard_stance',
      name: 'Guard Stance',
      category: 'combat',
      metadata: {
        combatAction: {
          mode: 'defense',
          acBonus: 2,
          temporaryHp: 3,
          durationRounds: 1,
          resourceCosts: []
        }
      }
    }, undefined, { authorization: true });
    await seedActors(tools, chat.id);
    await tools.executeTool('system.npc_state.patch_state', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      npcId: 'pc_arin',
      skillBar: {
        actions: [
          { id: 'skill_guard_stance', name: 'Guard Stance', mechanicKind: 'skill', skillId: 'skill_guard_stance' }
        ]
      },
      specialStatuses: [{
        id: 'blessed_strike',
        name: 'Blessed Strike',
        active: true,
        remainingTurns: 2,
        metadata: {
          attackBonus: 4,
          durationTiming: 'endTurn'
        }
      }]
    });
    await tools.executeTool('system.npc_state.patch_state', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      npcId: 'npc_guard',
      values: { hp: 20, maxHp: 20, armorClass: 14 },
      specialStatuses: [{
        id: 'flame_ward',
        name: 'Flame Ward',
        active: true,
        remainingTurns: 2,
        metadata: {
          acBonus: 1,
          incomingAttackDisadvantage: true,
          resistances: ['fire'],
          durationTiming: 'endTurn'
        }
      }]
    });
    await tools.executeTool('system.combat.start_battle', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      battleId: 'battle_modifiers',
      name: 'Modifier Battle',
      participantIds: ['pc_arin', 'npc_guard'],
      allyIds: ['pc_arin'],
      enemyIds: ['npc_guard']
    });

    const attack = await tools.executeTool('system.combat.resolve_action', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      battleId: 'battle_modifiers',
      actorId: 'pc_arin',
      targetId: 'npc_guard',
      forceMode: 'success',
      damage: [{ type: 'fire', amount: 10 }]
    });

    assert.equal(provider.calls.length, 0);
    assert.equal(attack.output.attack.input.successThreshold, 15);
    assert.equal(attack.output.attack.input.modifier, 4);
    assert.equal(attack.output.attack.input.rollMode, 'disadvantage');
    assert.equal(attack.output.settlement.records[0].data.values.hp, 15);

    await tools.executeTool('system.resources.reset_action_economy', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      npcId: 'pc_arin',
      movementMax: 30
    });
    const built = await tools.executeTool('system.combat.build_player_action', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      battleId: 'battle_modifiers',
      actorId: 'pc_arin',
      selectedActionId: 'skill_guard_stance'
    });
    assert.equal(built.output.resolveActionInput.targetId, 'pc_arin');
    assert.equal(built.output.resolveActionInput.actionKind, 'defense');

    const guarded = await tools.executeTool('system.combat.resolve_action', built.output.resolveActionInput);
    const guardedState = guarded.output.settlement.records[0].data;
    assert.equal(guardedState.values.temporaryHp, 3);
    const guardStatus = guardedState.specialStatuses.find((status) => status.id === 'skill_guard_stance_defense');
    assert.equal(guardStatus.remainingTurns, 1);
    assert.equal(guardStatus.metadata.acBonus, 2);
    assert.equal(guardStatus.metadata.durationTiming, 'endTurn');

    await tools.executeTool('system.triggers.tick_status_effects', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      timing: 'endTurn',
      turnActorId: 'pc_arin',
      apply: true
    });
    const expired = await tools.executeTool('system.npc_state.get_state', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      npcId: 'pc_arin'
    });
    assert.equal(expired.output.data.specialStatuses.find((status) => status.id === 'skill_guard_stance_defense'), undefined);
  } finally {
    dataManager.close();
    appDatabase.close();
  }
});
