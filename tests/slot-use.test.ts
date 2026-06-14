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
      name: 'Slot GM',
      first_mes: 'Begin.'
    }
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Slot Use Test',
    includeGreeting: false
  }).session;
  return { appDatabase, chat };
}

test('slot use directly applies inventory buff and trigger expiry removes it', async () => {
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
      values: { hp: 10, maxHp: 10 },
      statusBar: { hp: 10, maxHp: 10 },
      inventory: {
        items: [{
          id: 'elixir_guard',
          name: 'Elixir of Guard',
          quantity: 1,
          metadata: {
            acBonus: 2,
            durationRounds: 1,
            durationTiming: 'endTurn',
            targetPolicy: 'self',
            consumeItem: true
          }
        }]
      },
      resources: {
        consumables: {
          elixir_guard: { current: 1, max: 1, itemId: 'elixir_guard' }
        }
      }
    });

    const preview = await tools.executeTool('system.slot_use.preview_use', {
      chatSessionId: chat.id,
      sceneId: 'camp',
      actorId: 'pc_arin',
      sourceKind: 'item',
      itemId: 'elixir_guard'
    });
    assert.equal(preview.output.status, 'dry_run');
    assert.equal(preview.output.route, 'deterministic');
    assert.equal(preview.output.directPreview.output.settlement.targets[0].statuses.specialStatusUpdates.find((status) => status.id === 'elixir_guard_buff').metadata.acBonus, 2);

    const committed = await tools.executeTool('system.slot_use.commit_use', {
      chatSessionId: chat.id,
      sceneId: 'camp',
      actorId: 'pc_arin',
      sourceKind: 'item',
      itemId: 'elixir_guard'
    });
    assert.equal(committed.output.status, 'resolved');
    const state = committed.output.directResult.output.settlement.records[0].data;
    const buff = state.specialStatuses.find((status) => status.id === 'elixir_guard_buff');
    assert.equal(buff.remainingTurns, 1);
    assert.equal(buff.metadata.durationTiming, 'endTurn');
    const afterConsume = await tools.executeTool('system.npc_state.get_state', {
      chatSessionId: chat.id,
      sceneId: 'camp',
      npcId: 'pc_arin'
    });
    assert.equal(afterConsume.output.data.inventory.items.find((item) => item.id === 'elixir_guard'), undefined);

    await tools.executeTool('system.triggers.tick_status_effects', {
      chatSessionId: chat.id,
      sceneId: 'camp',
      timing: 'endTurn',
      turnActorId: 'pc_arin',
      apply: true
    });
    const expired = await tools.executeTool('system.npc_state.get_state', {
      chatSessionId: chat.id,
      sceneId: 'camp',
      npcId: 'pc_arin'
    });
    assert.equal(expired.output.data.specialStatuses.find((status) => status.id === 'elixir_guard_buff'), undefined);
  } finally {
    appDatabase.close();
  }
});

test('slot use executes skill-bar deterministic buff through combat resolver', async () => {
  const { appDatabase, chat } = createTestChat();
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const tools = createDefaultToolPluginManager({ appDatabase, dataManager, trace: false });

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
    await tools.executeTool('system.npc_state.patch_state', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      npcId: 'pc_arin',
      actorType: 'player',
      isPlayer: true,
      name: 'Arin',
      values: { hp: 10, maxHp: 10 },
      skillBar: {
        actions: [
          { id: 'skill_guard_stance', name: 'Guard Stance', mechanicKind: 'skill', skillId: 'skill_guard_stance' }
        ]
      }
    });

    const listed = await tools.executeTool('system.slot_use.list_slots', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      actorId: 'pc_arin'
    });
    assert.ok(listed.output.skillSlots.some((slot) => slot.actionId === 'skill_guard_stance'));

    const committed = await tools.executeTool('system.slot_use.commit_use', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      actorId: 'pc_arin',
      sourceKind: 'skill',
      skillId: 'skill_guard_stance'
    });
    assert.equal(committed.output.status, 'resolved');
    assert.equal(committed.output.directToolCall.tool, 'system.combat.resolve_action');
    const state = committed.output.directResult.output.settlement.records[0].data;
    assert.equal(state.values.temporaryHp, 3);
    const guard = state.specialStatuses.find((status) => status.id === 'skill_guard_stance_defense');
    assert.equal(guard.remainingTurns, 1);
    assert.equal(guard.metadata.acBonus, 2);
  } finally {
    dataManager.close();
    appDatabase.close();
  }
});

test('slot use routes special textual effects to adjudication instead of direct mutation', async () => {
  const { appDatabase, chat } = createTestChat();
  const tools = createDefaultToolPluginManager({ appDatabase, trace: false });

  try {
    await tools.executeTool('system.npc_state.patch_state', {
      chatSessionId: chat.id,
      sceneId: 'temple',
      npcId: 'pc_arin',
      actorType: 'player',
      isPlayer: true,
      name: 'Arin',
      inventory: {
        items: [{
          id: 'fate_blade',
          name: 'Fate Blade',
          quantity: 1,
          description: 'Once per story, may cut a thread of fate.',
          metadata: {
            specialText: 'May cut a thread of fate.',
            specialHandling: {
              requiresAdjudication: true,
              routeTo: 'system.action.resolve'
            }
          }
        }]
      }
    });

    const preview = await tools.executeTool('system.slot_use.preview_use', {
      chatSessionId: chat.id,
      sceneId: 'temple',
      actorId: 'pc_arin',
      sourceKind: 'item',
      itemId: 'fate_blade',
      sourceText: '我挥动命运之刃斩断这场失败。'
    });
    assert.equal(preview.output.status, 'needs_adjudication');
    assert.equal(preview.output.directToolCall, undefined);
    assert.equal(preview.output.adjudicationToolCall.tool, 'system.action.resolve');

    const state = await tools.executeTool('system.npc_state.get_state', {
      chatSessionId: chat.id,
      sceneId: 'temple',
      npcId: 'pc_arin'
    });
    assert.equal(state.output.data.specialStatuses.length, 0);
    assert.equal(state.output.data.inventory.items.find((item) => item.id === 'fate_blade').quantity, 1);
  } finally {
    appDatabase.close();
  }
});

test('slot use blocks inventory items with no direct effect and no narrative use text', async () => {
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
        items: [{
          id: 'plain_stone',
          name: 'Plain Stone',
          quantity: 1
        }]
      }
    });

    const committed = await tools.executeTool('system.slot_use.commit_use', {
      chatSessionId: chat.id,
      sceneId: 'camp',
      actorId: 'pc_arin',
      sourceKind: 'item',
      itemId: 'plain_stone'
    });

    assert.equal(committed.output.ok, false);
    assert.equal(committed.output.status, 'blocked');
    assert.equal(committed.output.reason, 'item_has_no_direct_effect');
    assert.equal(committed.output.directToolCall, undefined);

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
