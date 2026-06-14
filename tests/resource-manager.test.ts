// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppDatabase,
  NpcStructuredStateDatabase,
  RESOURCE_PLUGIN,
  ResourceManager,
  ToolPluginManager,
  createDefaultToolPluginManager,
  createResourceHandlers
} from '../src/index.js';

function createTestChat() {
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
  const character = appDatabase.importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Resource GM',
      first_mes: 'Begin.'
    }
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Resource Test',
    includeGreeting: false
  }).session;
  return { appDatabase, chat };
}

test('resource manager resets and spends deterministic action economy', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-resources-'));
  const { appDatabase, chat } = createTestChat();
  const npcState = new NpcStructuredStateDatabase({ appDatabase, trace: false });
  const resources = new ResourceManager({
    npcState,
    trace: {
      directory: join(directory, 'traces')
    }
  });

  try {
    npcState.patchNpcState({
      chatSessionId: chat.id,
      sceneId: 'battle',
      npcId: 'pc_arin',
      actorType: 'player',
      isPlayer: true,
      name: 'Arin',
      values: { speed: 30 }
    }, { source: 'test' });

    const reset = resources.resetActionEconomy({
      chatSessionId: chat.id,
      sceneId: 'battle',
      npcId: 'pc_arin',
      movementMax: 30,
      turnId: 'round-1-arin'
    });
    assert.equal(reset.actionEconomy.action.current, 1);
    assert.equal(reset.actionEconomy.bonusAction.current, 1);
    assert.equal(reset.actionEconomy.reaction.current, 1);
    assert.equal(reset.actionEconomy.movement.current, 30);
    assert.equal(existsSync(reset.trace.files.input), true);
    assert.equal(existsSync(reset.trace.files.stateAfter), true);

    const action = resources.spendActionEconomy({
      chatSessionId: chat.id,
      sceneId: 'battle',
      npcId: 'pc_arin',
      resource: 'action'
    });
    assert.equal(action.ok, true);
    assert.equal(action.before, 1);
    assert.equal(action.after, 0);

    const move = resources.spendActionEconomy({
      chatSessionId: chat.id,
      sceneId: 'battle',
      npcId: 'pc_arin',
      resource: 'movement',
      distance: 20
    });
    assert.equal(move.ok, true);
    assert.equal(move.before, 30);
    assert.equal(move.after, 10);

    const failedMove = resources.spendActionEconomy({
      chatSessionId: chat.id,
      sceneId: 'battle',
      npcId: 'pc_arin',
      resource: 'movement',
      distance: 15
    });
    assert.equal(failedMove.ok, false);
    assert.equal(failedMove.reason, 'insufficient_action_economy');
    assert.equal(failedMove.available, 10);

    const snapshot = resources.getActorResources({
      chatSessionId: chat.id,
      sceneId: 'battle',
      npcId: 'pc_arin'
    });
    assert.equal(snapshot.snapshot.actionEconomy.action.current, 0);
    assert.equal(snapshot.snapshot.actionEconomy.movement.current, 10);
  } finally {
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('resource manager spends spell slots, skill uses, ammo, consumables, and cooldowns', () => {
  const { appDatabase, chat } = createTestChat();
  const npcState = new NpcStructuredStateDatabase({ appDatabase, trace: false });
  const resources = new ResourceManager({ npcState, trace: false });

  try {
    npcState.patchNpcState({
      chatSessionId: chat.id,
      sceneId: 'battle',
      npcId: 'pc_arin',
      actorType: 'player',
      isPlayer: true,
      name: 'Arin',
      resources: {
        spellSlots: { level1: { current: 2, max: 2 } },
        skillUses: { second_wind: { current: 1, max: 1, recharge: 'shortRest' } },
        ammo: { arrows: { current: 5, max: 20, itemId: 'arrows' } },
        consumables: { potion_healing: { current: 2, max: 2, itemId: 'potion_healing' } }
      },
      inventory: {
        items: [
          { id: 'arrows', name: 'Arrows', quantity: 5 },
          { id: 'potion_healing', name: 'Healing Potion', quantity: 2 }
        ]
      }
    }, { source: 'test' });

    const spell = resources.spendResource({
      chatSessionId: chat.id,
      sceneId: 'battle',
      npcId: 'pc_arin',
      category: 'spellSlots',
      level: 1
    });
    assert.equal(spell.ok, true);
    assert.equal(spell.resourceId, 'level1');
    assert.equal(spell.after, 1);

    const skill = resources.spendResource({
      chatSessionId: chat.id,
      sceneId: 'battle',
      npcId: 'pc_arin',
      category: 'skillUses',
      resourceId: 'second_wind'
    });
    assert.equal(skill.after, 0);

    const ammo = resources.spendResource({
      chatSessionId: chat.id,
      sceneId: 'battle',
      npcId: 'pc_arin',
      category: 'ammo',
      resourceId: 'arrows',
      amount: 2
    });
    assert.equal(ammo.after, 3);
    assert.equal(ammo.record.data.inventory.items.find((item) => item.id === 'arrows').quantity, 3);

    const potion = resources.consumeItem({
      chatSessionId: chat.id,
      sceneId: 'battle',
      npcId: 'pc_arin',
      itemId: 'potion_healing'
    });
    assert.equal(potion.after, 1);
    assert.equal(potion.record.data.inventory.items.find((item) => item.id === 'potion_healing').quantity, 1);

    const cooldown = resources.startCooldown({
      chatSessionId: chat.id,
      sceneId: 'battle',
      npcId: 'pc_arin',
      cooldownId: 'second_wind',
      turns: 2
    });
    assert.equal(cooldown.cooldown.remainingTurns, 2);
    assert.equal(cooldown.cooldown.ready, false);

    const tickOne = resources.tickCooldowns({
      chatSessionId: chat.id,
      sceneId: 'battle',
      npcId: 'pc_arin'
    });
    assert.equal(tickOne.results[0].updates[0].after, 1);

    const tickTwo = resources.tickCooldowns({
      chatSessionId: chat.id,
      sceneId: 'battle',
      npcId: 'pc_arin'
    });
    assert.equal(tickTwo.results[0].updates[0].after, 0);
    assert.equal(tickTwo.results[0].record.data.resources.cooldowns.second_wind.ready, true);
  } finally {
    appDatabase.close();
  }
});

test('resource plugin exposes no-LLM resource tools through explicit and default managers', async () => {
  const { appDatabase, chat } = createTestChat();
  const npcState = new NpcStructuredStateDatabase({ appDatabase, trace: false });
  const resources = new ResourceManager({ npcState, trace: false });
  const tools = new ToolPluginManager({ trace: false });
  tools.createPlugin(RESOURCE_PLUGIN, {
    handlers: createResourceHandlers({ manager: resources })
  });

  try {
    const set = await tools.executeTool('system.resources.set_resource', {
      chatSessionId: chat.id,
      sceneId: 'battle',
      npcId: 'pc_arin',
      actorType: 'player',
      isPlayer: true,
      category: 'spellSlots',
      level: 2,
      current: 1,
      max: 1
    });
    assert.equal(set.output.resourceId, 'level2');
    assert.equal(set.output.resource.current, 1);

    const spent = await tools.executeTool('system.resources.spend_resource', {
      chatSessionId: chat.id,
      sceneId: 'battle',
      npcId: 'pc_arin',
      category: 'spellSlots',
      level: 2
    });
    assert.equal(spent.output.after, 0);

    const defaultTools = createDefaultToolPluginManager({ appDatabase, trace: false });
    assert.equal(defaultTools.getTool('system.resources.spend_action_economy').id, 'system.resources.spend_action_economy');
    assert.equal(defaultTools.getTool('system.resources.tick_cooldowns').metadata.llm, undefined);
    assert.equal(defaultTools.getPlugin('system.resources').metadata.llm, false);
  } finally {
    appDatabase.close();
  }
});
