// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppDatabase,
  SQLiteDataManager,
  createDefaultToolPluginManager
} from '../src/index.js';

function createTestChat() {
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
  const character = appDatabase.importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Modifier GM',
      first_mes: 'Begin.'
    }
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Modifier Test',
    includeGreeting: false
  }).session;
  return { appDatabase, chat };
}

test('modifier resolver combines actor buffs, target AC, disadvantage, and damage defenses', async () => {
  const { appDatabase, chat } = createTestChat();
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const tools = createDefaultToolPluginManager({ appDatabase, dataManager, trace: false });

  try {
    await tools.executeTool('system.npc_state.patch_state', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      npcId: 'pc_mage',
      actorType: 'player',
      isPlayer: true,
      values: { hp: 20, maxHp: 20 },
      specialStatuses: [{
        id: 'bless_weapon',
        name: 'Bless Weapon',
        active: true,
        remainingTurns: 2,
        metadata: {
          attackBonus: 3,
          durationTiming: 'endTurn'
        }
      }]
    });
    await tools.executeTool('system.npc_state.patch_state', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      npcId: 'npc_shielded',
      actorType: 'npc',
      values: { hp: 20, maxHp: 20, armorClass: 14 },
      specialStatuses: [{
        id: 'shielded',
        name: 'Shielded',
        active: true,
        remainingTurns: 1,
        metadata: {
          acBonus: 2,
          incomingAttackDisadvantage: true,
          resistances: ['fire'],
          immunities: ['poison'],
          durationTiming: 'endTurn'
        }
      }]
    });

    const resolved = await tools.executeTool('system.modifiers.resolve_check_modifiers', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      actorId: 'pc_mage',
      targetId: 'npc_shielded',
      checkKind: 'attack',
      base: {
        successThreshold: 10,
        diceCount: 1,
        diceSides: 20,
        modifier: 1
      }
    });

    assert.equal(resolved.output.resolved.successThreshold, 16);
    assert.equal(resolved.output.resolved.modifier, 4);
    assert.equal(resolved.output.resolved.rollMode, 'disadvantage');
    assert.ok(resolved.output.sources.some((source) => source.sourceId === 'bless_weapon' && source.effect === 'modifier'));
    assert.ok(resolved.output.sources.some((source) => source.sourceId === 'shielded' && source.effect === 'successThreshold'));

    const defenses = await tools.executeTool('system.modifiers.resolve_damage_defenses', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      targetId: 'npc_shielded',
      damageTypes: ['fire', 'poison']
    });

    assert.deepEqual(defenses.output.defenses.resistances, ['fire']);
    assert.deepEqual(defenses.output.defenses.immunities, ['poison']);
  } finally {
    dataManager.close();
    appDatabase.close();
  }
});
