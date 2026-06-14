// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppDatabase,
  NpcStructuredStateDatabase,
  PartyManager,
  QuestManager,
  TRIGGER_PLUGIN,
  TriggerManager,
  ToolPluginManager,
  createDefaultToolPluginManager,
  createTriggerHandlers
} from '../src/index.js';

function createTestChat(options = {}) {
  const appDatabase = new AppDatabase({
    databasePath: ':memory:',
    chatDataDirectory: options.chatDataDirectory
  });
  const character = appDatabase.importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Trigger GM',
      first_mes: 'Begin.'
    }
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Trigger Test',
    includeGreeting: false
  }).session;
  return { appDatabase, chat };
}

test('trigger manager enforces death state and can revive actors', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-triggers-death-'));
  const { appDatabase, chat } = createTestChat({ chatDataDirectory: directory });
  const npcState = new NpcStructuredStateDatabase({ appDatabase, trace: false });
  const triggers = new TriggerManager({
    appDatabase,
    npcState,
    trace: {
      directory: join(directory, 'traces')
    }
  });

  try {
    npcState.patchNpcState({
      chatSessionId: chat.id,
      sceneId: 'crypt',
      npcId: 'npc_guard',
      name: 'Guard',
      values: { hp: 0, maxHp: 12 },
      statusBar: { hp: 0, maxHp: 12, conditions: [] }
    });

    const dying = triggers.scanDeathTriggers({
      chatSessionId: chat.id,
      sceneId: 'crypt',
      apply: true
    });
    assert.equal(dying.count, 1);
    assert.equal(dying.results[0].record.data.statusBar.deathSaves.dying, true);
    assert.ok(dying.results[0].record.data.statusBar.conditions.includes('dying'));

    npcState.patchNpcState({
      chatSessionId: chat.id,
      sceneId: 'crypt',
      npcId: 'npc_guard',
      values: { deathSaveFailures: 3 },
      statusBar: { deathSaves: { failures: 3 } }
    });
    const dead = triggers.scanDeathTriggers({
      chatSessionId: chat.id,
      sceneId: 'crypt',
      apply: true
    });
    assert.equal(dead.results[0].decision.state, 'dead');
    assert.ok(dead.results[0].record.data.statusBar.conditions.includes('dead'));

    const revived = triggers.reviveActor({
      chatSessionId: chat.id,
      sceneId: 'crypt',
      npcId: 'npc_guard',
      hp: 5
    });
    assert.equal(revived.record.data.values.hp, 5);
    assert.equal(revived.record.data.statusBar.deathSaves.dead, false);
    assert.equal(revived.record.data.statusBar.conditions.includes('dead'), false);
  } finally {
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('status trigger applies periodic damage and expires duration', () => {
  const { appDatabase, chat } = createTestChat();
  const npcState = new NpcStructuredStateDatabase({ appDatabase, trace: false });
  const triggers = new TriggerManager({ appDatabase, npcState, trace: false });

  try {
    npcState.patchNpcState({
      chatSessionId: chat.id,
      sceneId: 'arena',
      npcId: 'npc_ooze',
      name: 'Ooze',
      values: { hp: 10, maxHp: 10 },
      statusBar: { hp: 10, maxHp: 10, conditions: ['burning'] },
      specialStatuses: [{
        id: 'burning',
        name: 'Burning',
        active: true,
        remainingTurns: 2,
        metadata: {
          tickTiming: 'endTurn',
          damage: [{ type: 'fire', amount: 3 }]
        }
      }]
    });

    const first = triggers.tickStatusEffects({
      chatSessionId: chat.id,
      sceneId: 'arena',
      timing: 'endTurn',
      apply: true
    });
    assert.equal(first.count, 1);
    assert.equal(first.results[0].settlement.records[0].data.values.hp, 7);
    assert.equal(first.results[0].record.data.specialStatuses.find((status) => status.id === 'burning').remainingTurns, 1);

    const second = triggers.tickStatusEffects({
      chatSessionId: chat.id,
      sceneId: 'arena',
      timing: 'endTurn',
      apply: true
    });
    assert.equal(second.results[0].settlement.records[0].data.values.hp, 4);
    assert.equal(second.results[0].record.data.specialStatuses.find((status) => status.id === 'burning'), undefined);
    assert.equal(second.results[0].record.data.statusBar.conditions.includes('burning'), false);
  } finally {
    appDatabase.close();
  }
});

test('status trigger handles poison ticks, burning duration, and turn-gated shield expiry', () => {
  const { appDatabase, chat } = createTestChat();
  const npcState = new NpcStructuredStateDatabase({ appDatabase, trace: false });
  const triggers = new TriggerManager({ appDatabase, npcState, trace: false });

  try {
    npcState.patchNpcState({
      chatSessionId: chat.id,
      sceneId: 'bridge',
      npcId: 'pc_knight',
      actorType: 'player',
      isPlayer: true,
      name: 'Knight',
      values: { hp: 15, maxHp: 15 },
      statusBar: {
        hp: 15,
        maxHp: 15,
        conditions: ['poisoned', 'burning', 'shield']
      },
      specialStatuses: [
        {
          id: 'poisoned',
          name: 'Poisoned',
          active: true,
          metadata: {
            tickTiming: 'endTurn',
            damage: [{ type: 'poison', amount: 2 }]
          }
        },
        {
          id: 'burning',
          name: 'Burning',
          active: true,
          remainingTurns: 3,
          metadata: {
            tickTiming: 'endTurn',
            damage: [{ type: 'fire', amount: 1 }]
          }
        },
        {
          id: 'shield',
          name: 'Shield',
          active: true,
          remainingTurns: 1,
          metadata: {
            durationTiming: 'endTurn',
            expiresOnActorId: 'pc_knight'
          }
        }
      ]
    });

    const first = triggers.tickStatusEffects({
      chatSessionId: chat.id,
      sceneId: 'bridge',
      timing: 'endTurn',
      turnActorId: 'pc_knight',
      apply: true
    });

    assert.equal(first.count, 3);
    assert.equal(npcState.getNpcState({ chatSessionId: chat.id, sceneId: 'bridge', npcId: 'pc_knight' }).data.values.hp, 12);
    assert.equal(first.results.find((result) => result.statusId === 'shield').expires, true);
    assert.equal(npcState.getNpcState({ chatSessionId: chat.id, sceneId: 'bridge', npcId: 'pc_knight' }).data.specialStatuses.find((status) => status.id === 'shield'), undefined);

    triggers.tickStatusEffects({
      chatSessionId: chat.id,
      sceneId: 'bridge',
      timing: 'endTurn',
      turnActorId: 'pc_knight',
      apply: true
    });
    const third = triggers.tickStatusEffects({
      chatSessionId: chat.id,
      sceneId: 'bridge',
      timing: 'endTurn',
      turnActorId: 'pc_knight',
      apply: true
    });

    const finalState = npcState.getNpcState({ chatSessionId: chat.id, sceneId: 'bridge', npcId: 'pc_knight' }).data;
    assert.equal(finalState.values.hp, 6);
    assert.equal(finalState.specialStatuses.find((status) => status.id === 'burning'), undefined);
    assert.ok(finalState.specialStatuses.find((status) => status.id === 'poisoned'));
    assert.equal(third.results.find((result) => result.statusId === 'burning').expires, true);
  } finally {
    appDatabase.close();
  }
});

test('quest, party assignment, and encounter triggers are deterministic and storable', async () => {
  const { appDatabase, chat } = createTestChat();
  const questManager = new QuestManager({ appDatabase, trace: false });
  const partyManager = new PartyManager({ appDatabase });
  const triggers = new TriggerManager({
    appDatabase,
    questManager,
    partyManager,
    trace: false,
    random: () => 0.99
  });
  const toolManager = new ToolPluginManager({ trace: false });
  toolManager.createPlugin(TRIGGER_PLUGIN, {
    handlers: createTriggerHandlers({ manager: triggers })
  });

  try {
    await questManager.createHook({
      chatSessionId: chat.id,
      quest: {
        questId: 'well_mystery',
        title: '井底回声',
        objective: '查明井底声音',
        successCriteria: ['查明来源'],
        evidenceSlots: [{ id: 'source', description: '来源', required: true }]
      }
    });
    questManager.setQuestClock({
      chatSessionId: chat.id,
      questId: 'well_mystery',
      expiresAtElapsedSeconds: 10,
      expireMode: 'fail'
    });
    const expired = await toolManager.executeTool('system.triggers.scan_quest_triggers', {
      chatSessionId: chat.id,
      elapsedSeconds: 11,
      apply: true
    });
    assert.equal(expired.output.count, 1);
    assert.equal(expired.output.expired[0].quest.data.status, 'failed');

    partyManager.addMember({
      chatSessionId: chat.id,
      npcId: 'npc_mira',
      name: 'Mira',
      activityStatus: 'assigned',
      assignment: {
        title: '侦察',
        objective: '查旧市场',
        due: { elapsedSeconds: 20 }
      }
    });
    const dueParty = await toolManager.executeTool('system.triggers.scan_party_assignment_triggers', {
      chatSessionId: chat.id,
      elapsedSeconds: 21,
      apply: true
    });
    assert.equal(dueParty.output.count, 1);
    assert.equal(dueParty.output.results[0].record.data.assignment.status, 'due');

    const encounter = await toolManager.executeTool('system.triggers.roll_encounter_trigger', {
      chatSessionId: chat.id,
      sceneId: 'road',
      chance: 0.5,
      roll: 0.25,
      pickRoll: 0.95,
      apply: true,
      table: [
        { id: 'small', title: 'Small sign', weight: 1 },
        { id: 'rare', title: 'Rare wonder', weight: 1 }
      ]
    });
    assert.equal(encounter.output.triggered, true);
    assert.equal(encounter.output.selected.id, 'rare');

    const events = await toolManager.executeTool('system.triggers.list_trigger_events', {
      chatSessionId: chat.id
    });
    assert.ok(events.output.records.length >= 3);

    const defaultTools = createDefaultToolPluginManager({ appDatabase, trace: false });
    const ids = defaultTools.listTools().map((tool) => tool.id);
    assert.ok(ids.includes('system.triggers.scan_death_triggers'));
    assert.ok(ids.includes('system.triggers.roll_encounter_trigger'));
  } finally {
    appDatabase.close();
  }
});
