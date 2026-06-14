// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppDatabase,
  createDefaultToolPluginManager
} from '../src/index.js';

function createTestChat() {
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
  const character = appDatabase.importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Item GM',
      first_mes: 'Begin.'
    }
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Item Use Test',
    includeGreeting: false
  }).session;
  return { appDatabase, chat };
}

test('item use consumes an owned potion and applies healing through existing effect/resource tools', async () => {
  const { appDatabase, chat } = createTestChat();
  const tools = createDefaultToolPluginManager({ appDatabase, trace: false });

  try {
    await tools.executeTool('system.npc_state.patch_state', {
      chatSessionId: chat.id,
      sceneId: 'camp',
      npcId: 'pc_arin',
      actorType: 'player',
      isPlayer: true,
      name: 'Arin',
      values: { hp: 4, maxHp: 10 },
      statusBar: { hp: 4, maxHp: 10 },
      resources: {
        consumables: { potion_healing: { current: 2, max: 2, itemId: 'potion_healing' } }
      },
      inventory: {
        items: [{ id: 'potion_healing', name: 'Healing Potion', quantity: 2 }]
      }
    });

    const used = await tools.executeTool('system.item_use.use_item', {
      chatSessionId: chat.id,
      sceneId: 'camp',
      actorId: 'pc_arin',
      itemId: 'potion_healing',
      targetId: 'pc_arin',
      consumeQuantity: 1,
      healing: [{ type: 'potion', amount: 4 }]
    });

    assert.equal(used.output.ok, true);
    assert.equal(used.output.llmUsed, false);
    assert.equal(used.output.settlement.records[0].data.values.hp, 8);
    assert.equal(used.output.costApplications[0].result.output.after, 1);

    const state = await tools.executeTool('system.npc_state.get_state', {
      chatSessionId: chat.id,
      sceneId: 'camp',
      npcId: 'pc_arin'
    });
    assert.equal(state.output.data.inventory.items.find((item) => item.id === 'potion_healing').quantity, 1);
    assert.equal(state.output.data.resources.consumables.potion_healing.current, 1);
  } finally {
    appDatabase.close();
  }
});

test('item use can equip and unequip inventory items without duplicating equipment logic elsewhere', async () => {
  const { appDatabase, chat } = createTestChat();
  const tools = createDefaultToolPluginManager({ appDatabase, trace: false });

  try {
    await tools.executeTool('system.npc_state.patch_state', {
      chatSessionId: chat.id,
      sceneId: 'armory',
      npcId: 'pc_arin',
      actorType: 'player',
      isPlayer: true,
      name: 'Arin',
      inventory: {
        items: [{ id: 'longsword', name: 'Longsword', quantity: 1 }]
      }
    });

    const equipped = await tools.executeTool('system.item_use.equip_item', {
      chatSessionId: chat.id,
      sceneId: 'armory',
      actorId: 'pc_arin',
      itemId: 'longsword',
      itemKind: 'weapon',
      slot: 'mainHand'
    });
    assert.equal(equipped.output.status, 'equipped');
    assert.equal(equipped.output.record.data.equipment.mainHand.id, 'longsword');
    assert.equal(equipped.output.record.data.inventory.items.find((item) => item.id === 'longsword').equipped, true);

    const unequipped = await tools.executeTool('system.item_use.unequip_item', {
      chatSessionId: chat.id,
      sceneId: 'armory',
      actorId: 'pc_arin',
      slot: 'mainHand'
    });
    assert.equal(unequipped.output.status, 'unequipped');
    assert.equal(unequipped.output.record.data.equipment.mainHand, undefined);
    assert.equal(unequipped.output.record.data.inventory.items.find((item) => item.id === 'longsword').equipped, false);
  } finally {
    appDatabase.close();
  }
});

test('item use blocks missing items and is registered by the default tool manager', async () => {
  const { appDatabase, chat } = createTestChat();
  const tools = createDefaultToolPluginManager({ appDatabase, trace: false });

  try {
    await tools.executeTool('system.npc_state.patch_state', {
      chatSessionId: chat.id,
      sceneId: 'market',
      npcId: 'pc_arin',
      actorType: 'player',
      isPlayer: true,
      name: 'Arin',
      inventory: { items: [] }
    });

    const blocked = await tools.executeTool('system.item_use.use_item', {
      chatSessionId: chat.id,
      sceneId: 'market',
      actorId: 'pc_arin',
      itemId: 'missing_potion',
      consumeQuantity: 1,
      healing: [{ amount: 5 }]
    });

    assert.equal(blocked.output.ok, false);
    assert.equal(blocked.output.reason, 'item_not_owned');
    assert.equal(tools.getTool('system.item_use.use_item').pluginId, 'system.item_use');
    assert.equal(tools.getTool('system.item_use.equip_item').id, 'system.item_use.equip_item');
  } finally {
    appDatabase.close();
  }
});

test('item use blocks owned items that have no direct effect instead of returning an empty success', async () => {
  const { appDatabase, chat } = createTestChat();
  const tools = createDefaultToolPluginManager({ appDatabase, trace: false });

  try {
    await tools.executeTool('system.npc_state.patch_state', {
      chatSessionId: chat.id,
      sceneId: 'camp',
      npcId: 'pc_arin',
      actorType: 'player',
      isPlayer: true,
      name: 'Arin',
      inventory: {
        items: [{ id: 'plain_stone', name: 'Plain Stone', quantity: 1 }]
      }
    });

    const used = await tools.executeTool('system.item_use.use_item', {
      chatSessionId: chat.id,
      sceneId: 'camp',
      actorId: 'pc_arin',
      itemId: 'plain_stone'
    });

    assert.equal(used.output.ok, false);
    assert.equal(used.output.status, 'blocked');
    assert.equal(used.output.reason, 'item_has_no_direct_effect');

    const state = await tools.executeTool('system.npc_state.get_state', {
      chatSessionId: chat.id,
      sceneId: 'camp',
      npcId: 'pc_arin'
    });
    assert.equal(state.output.data.inventory.items.find((item) => item.id === 'plain_stone').quantity, 1);
  } finally {
    appDatabase.close();
  }
});
