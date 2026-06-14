// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppDatabase,
  DiceEngine,
  NpcStructuredStateDatabase,
  SQLiteDataManager,
  createDefaultToolPluginManager,
  runDiceCheck
} from '../src/index.js';

test('dice check succeeds when total reaches threshold', () => {
  const result = runDiceCheck({
    successThreshold: 15,
    diceCount: 1,
    diceSides: 20,
    modifier: 3,
    abilityModifier: 2,
    proficiencyBonus: 2
  }, {
    randomInt: () => 8
  });

  assert.equal(result.total, 15);
  assert.equal(result.outcome, 'success');
  assert.equal(result.success, true);
  assert.equal(result.dice.expression, '1d20+7');
});

test('d20 natural 20 is critical success and natural 1 is critical failure', () => {
  const criticalSuccess = runDiceCheck({
    successThreshold: 99,
    diceCount: 1,
    diceSides: 20
  }, {
    randomInt: () => 20
  });

  assert.equal(criticalSuccess.outcome, 'criticalSuccess');
  assert.equal(criticalSuccess.success, true);

  const criticalFailure = runDiceCheck({
    successThreshold: 1,
    diceCount: 1,
    diceSides: 20,
    modifier: 99
  }, {
    randomInt: () => 1
  });

  assert.equal(criticalFailure.outcome, 'criticalFailure');
  assert.equal(criticalFailure.failure, true);
});

test('supports multi-die sums with non-d20 dice', () => {
  const rolls = [4, 5, 6];
  const result = runDiceCheck({
    successThreshold: 16,
    diceCount: 3,
    diceSides: 6,
    modifier: 1,
    criticalMode: 'none'
  }, {
    randomInt: () => rolls.shift()
  });

  assert.deepEqual(result.rolls, [4, 5, 6]);
  assert.equal(result.naturalTotal, 15);
  assert.equal(result.total, 16);
  assert.equal(result.outcome, 'success');
  assert.equal(result.dice.expression, '3d6+1');
});

test('advantage keeps higher candidate and disadvantage keeps lower candidate', () => {
  const advantageRolls = [3, 17];
  const advantage = runDiceCheck({
    successThreshold: 10,
    diceCount: 1,
    diceSides: 20,
    rollMode: 'advantage'
  }, {
    randomInt: () => advantageRolls.shift()
  });
  assert.deepEqual(advantage.rolls, [17]);
  assert.equal(advantage.outcome, 'success');

  const disadvantageRolls = [18, 5];
  const disadvantage = runDiceCheck({
    successThreshold: 10,
    diceCount: 1,
    diceSides: 20,
    rollMode: 'disadvantage'
  }, {
    randomInt: () => disadvantageRolls.shift()
  });
  assert.deepEqual(disadvantage.rolls, [5]);
  assert.equal(disadvantage.outcome, 'failure');
});

test('inspiration rerolls failed checks and selects first success', () => {
  const rolls = [4, 7, 15];
  const result = runDiceCheck({
    successThreshold: 12,
    diceCount: 1,
    diceSides: 20,
    inspirationPoints: 2
  }, {
    randomInt: () => rolls.shift()
  });

  assert.equal(result.inspiration.used, 2);
  assert.equal(result.attempts.length, 3);
  assert.equal(result.selectedAttempt.attempt, 3);
  assert.equal(result.outcome, 'success');
});

test('force mode overrides threshold outcome', () => {
  const success = runDiceCheck({
    successThreshold: 30,
    diceCount: 1,
    diceSides: 20,
    forceMode: 'success'
  }, {
    randomInt: () => 2
  });

  assert.equal(success.forced, true);
  assert.equal(success.outcome, 'success');
  assert.equal(success.success, true);

  const failure = runDiceCheck({
    successThreshold: 1,
    diceCount: 1,
    diceSides: 20,
    forceMode: 'criticalFailure'
  }, {
    randomInt: () => 20
  });

  assert.equal(failure.outcome, 'criticalFailure');
  assert.equal(failure.criticalFailure, true);
});

test('dice engine accepts injectable random source', () => {
  const engine = new DiceEngine({ randomInt: () => 12 });
  const result = engine.check({
    successThreshold: 12,
    diceCount: 1,
    diceSides: 20
  });

  assert.equal(result.outcome, 'success');
});

test('supports rollCount, buff, and debuff aliases', () => {
  const rolls = [3, 4];
  const result = runDiceCheck({
    target: 10,
    rollCount: 2,
    diceSides: 6,
    buff: 5,
    debuff: 2,
    criticalMode: 'none'
  }, {
    randomInt: () => rolls.shift()
  });

  assert.equal(result.dice.expression, '2d6+3');
  assert.equal(result.total, 10);
  assert.equal(result.outcome, 'success');
});

test('inspiration reroll tool asks the player then spends actor inspiration on confirmed reroll', async () => {
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:', schemaDirectory: null });
  const character = appDatabase.importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Dice GM',
      first_mes: 'Begin.'
    }
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Dice Inspiration Test',
    includeGreeting: false
  }).session;
  const actorState = new NpcStructuredStateDatabase({ appDatabase, trace: false });
  const manager = createDefaultToolPluginManager({
    appDatabase,
    dataManager,
    trace: false
  });

  try {
    actorState.rewriteNpcState({
      chatSessionId: chat.id,
      sceneId: 'camp',
      npcId: 'pc_arin',
      actorType: 'player',
      isPlayer: true,
      playerId: 'player_1',
      name: 'Arin',
      statusBar: {
        hp: 12,
        inspiration: 1
      }
    });

    const failedResult = {
      outcome: 'failure',
      success: false,
      failure: true,
      critical: false,
      criticalSuccess: false,
      criticalFailure: false,
      successThreshold: 10,
      dice: { count: 1, sides: 20 },
      rollMode: 'normal',
      criticalMode: 'd20',
      modifierTotal: 0,
      rolls: [4],
      total: 4
    };
    const diceInput = {
      successThreshold: 0,
      diceCount: 1,
      diceSides: 2,
      criticalMode: 'none'
    };

    const offered = await manager.executeTool('game.dice.offer_inspiration_reroll', {
      chatSessionId: chat.id,
      sceneId: 'camp',
      actorId: 'pc_arin',
      diceResult: failedResult,
      diceInput
    });
    assert.equal(offered.output.status, 'needs_player_decision');
    assert.equal(offered.output.availableInspiration, 1);
    assert.equal(offered.output.choices[0].id, 'reroll');

    const unauthorized = await manager.executeTool('game.dice.offer_inspiration_reroll', {
      chatSessionId: chat.id,
      sceneId: 'camp',
      actorId: 'pc_arin',
      diceResult: failedResult,
      diceInput,
      decision: 'reroll'
    });
    assert.equal(unauthorized.output.status, 'needs_player_decision');
    assert.equal(unauthorized.output.reason, 'missing_user_authorization');
    assert.equal(actorState.getNpcState({
      chatSessionId: chat.id,
      sceneId: 'camp',
      npcId: 'pc_arin'
    }).data.statusBar.inspiration, 1);

    const rerolled = await manager.executeTool('game.dice.offer_inspiration_reroll', {
      chatSessionId: chat.id,
      sceneId: 'camp',
      actorId: 'pc_arin',
      diceResult: failedResult,
      diceInput,
      decision: 'reroll'
    }, undefined, { authorization: true });

    assert.equal(rerolled.output.status, 'rerolled');
    assert.equal(rerolled.output.spent, true);
    assert.equal(rerolled.output.inspirationBefore, 1);
    assert.equal(rerolled.output.inspirationAfter, 0);
    assert.equal(rerolled.output.rerollResult.success, true);
    assert.equal(actorState.getNpcState({
      chatSessionId: chat.id,
      sceneId: 'camp',
      npcId: 'pc_arin'
    }).data.statusBar.inspiration, 0);
  } finally {
    dataManager.close();
    appDatabase.close();
  }
});

test('dice remote control can force dice sides and optional fixed face values', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:', schemaDirectory: null });
  const manager = createDefaultToolPluginManager({
    dataManager,
    trace: false
  });

  try {
    const inactive = await manager.executeTool('game.dice.remote_control', {});
    assert.equal(inactive.output.status, 'inactive');

    const unauthorized = await manager.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20
    });
    assert.equal(unauthorized.output.status, 'requires_authorization');

    const enabled = await manager.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 20,
      fixedRoll: 20,
      reason: 'debug crit'
    }, undefined, { authorization: true });
    assert.equal(enabled.output.status, 'set');
    assert.equal(enabled.output.config.diceSides, 20);
    assert.equal(enabled.output.config.fixedRoll, 20);

    const critical = await manager.executeTool('game.dice.check', {
      successThreshold: 99,
      diceCount: 1,
      diceSides: 6,
      criticalMode: 'd20'
    });
    assert.equal(critical.output.dice.sides, 20);
    assert.deepEqual(critical.output.rolls, [20]);
    assert.equal(critical.output.outcome, 'criticalSuccess');
    assert.equal(critical.output.remoteControl.originalDiceSides, 6);
    assert.equal(critical.output.remoteControl.fixedRollActive, true);

    await manager.executeTool('game.dice.remote_control', {
      action: 'set',
      diceSides: 4,
      fixedRoll: null
    }, undefined, { authorization: true });
    const d4 = await manager.executeTool('game.dice.check', {
      successThreshold: 99,
      diceCount: 2,
      diceSides: 20,
      criticalMode: 'none'
    });
    assert.equal(d4.output.dice.sides, 4);
    assert.equal(d4.output.rolls.length, 2);
    assert.ok(d4.output.rolls.every((roll) => roll >= 1 && roll <= 4));
    assert.equal(d4.output.remoteControl.fixedRollActive, false);

    await manager.executeTool('game.dice.remote_control', {
      action: 'clear'
    }, undefined, { authorization: true });
    const normal = await manager.executeTool('game.dice.check', {
      successThreshold: 0,
      diceCount: 1,
      diceSides: 6,
      criticalMode: 'none'
    });
    assert.equal(normal.output.dice.sides, 6);
    assert.equal(normal.output.remoteControl, undefined);
  } finally {
    dataManager.close();
  }
});
