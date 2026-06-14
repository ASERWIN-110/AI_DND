// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentChatRuntime,
  AppDatabase,
  extractAgentLoopAssistantContent,
  MockChatProvider,
  SQLiteDataManager,
  StructuredInterfaceStateStore
} from '../src/index.js';

const card = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Mira',
    description: 'A test GM.',
    first_mes: 'Begin.',
    character_book: {
      entries: [
        {
          uid: 1,
          key: ['door'],
          content: 'The door is bronze.'
        }
      ]
    }
  }
};

test('runtime creates a session and sends a message', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const runtime = new AgentChatRuntime({ chatProvider: new MockChatProvider(), dataManager });
  const session = await runtime.createSession({ characterCard: card, userName: 'Player' });
  const result = await runtime.sendMessage(session.id, 'I inspect the door.');

  assert.equal(result.session.messages.length, 3);
  assert.match(result.assistantMessage.content, /门槛前的痕迹|湿盐线/);
  assert.doesNotMatch(result.assistantMessage.content, /# Current Input|# Raw Input|框架|Prompt/);
  assert.ok(result.prompt.itemization.some((item) => item.id === 'world-info'));
  dataManager.close();
});

test('runtime skips rag retrieval when agent policy blocks rag read', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const runtime = new AgentChatRuntime({ chatProvider: new MockChatProvider(), dataManager });
  const session = await runtime.createSession({ characterCard: card, userName: 'Player' });
  await runtime.ingestMemory({
    collection: session.collection,
    sourceId: 'bronze-door-note',
    text: 'The bronze door is sealed by a moon-shaped key.'
  });

  const withRag = await runtime.sendMessage(session.id, 'What do I know about the bronze door?', {
    minScore: 0
  });
  assert.ok(withRag.assistantMessage.metadata.ragContext.length > 0);

  const withoutRag = await runtime.sendMessage(session.id, 'Check the bronze door again.', {
    minScore: 0,
    agentAccessPolicy: {
      database: { read: true, write: true },
      rag: { read: false, write: true }
    }
  });
  assert.equal(withoutRag.assistantMessage.metadata.ragContext.length, 0);

  const withoutRuntimeRag = await runtime.sendMessage(session.id, 'Check the bronze door a third time.', {
    minScore: 0,
    agentAccessPolicy: {
      database: { read: true, write: true },
      rag: { read: true, write: true },
      runtimeRag: { read: false, write: true }
    }
  });
  assert.equal(withoutRuntimeRag.assistantMessage.metadata.ragContext.length, 0);
  dataManager.close();
});

test('runtime publishes dice roll progress events from dice tool results', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const runtime = new AgentChatRuntime({ chatProvider: new MockChatProvider(), dataManager });
  try {
    const chatSessionId = 'chat_dice_progress_test';
    await runtime.toolPluginManager.executeTool('game.dice.check', {
      successThreshold: 12,
      diceCount: 1,
      diceSides: 20,
      modifier: 3
    }, undefined, {
      chatSessionId,
      turnId: 'turn_dice_progress'
    });

    const events = runtime.listAgentProgressEvents({ chatSessionId });
    const diceEvent = events.find((event) => event.type === 'dice_roll_resolved');
    assert.ok(diceEvent);
    assert.equal(diceEvent.chatSessionId, chatSessionId);
    assert.equal(diceEvent.turnId, 'turn_dice_progress');
    assert.equal(diceEvent.toolId, 'game.dice.check');
    assert.equal(diceEvent.diceRoll.result.dice.sides, 20);
    assert.equal(diceEvent.diceRoll.result.modifierTotal, 3);
    assert.equal(diceEvent.diceRoll.result.successThreshold, 12);
  } finally {
    dataManager.close();
  }
});

test('runtime publishes nested dice progress with inherited parent chat context', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const runtime = new AgentChatRuntime({ chatProvider: new MockChatProvider(), dataManager });
  try {
    const chatSessionId = 'chat_nested_dice_progress_test';
    runtime.toolPluginManager.createPlugin({
      id: 'debug.parent',
      name: 'Debug Parent Tool',
      tools: [{
        name: 'roll_nested',
        description: 'Call the dice tool without repeating chat context.',
        inputSchema: {
          type: 'object',
          properties: { chatSessionId: { type: 'string' } },
          required: ['chatSessionId'],
          additionalProperties: false
        }
      }]
    }, {
      handlers: {
        roll_nested: async () => {
          const roll = await runtime.toolPluginManager.executeTool('game.dice.check', {
            successThreshold: 10,
            diceCount: 1,
            diceSides: 20,
            modifier: 1,
            forceMode: 'success'
          });
          return { roll: roll.output };
        }
      }
    });

    await runtime.toolPluginManager.executeTool('debug.parent.roll_nested', {
      chatSessionId
    }, undefined, {
      turnId: 'turn_nested_dice_progress'
    });

    const events = runtime.listAgentProgressEvents({ chatSessionId });
    const diceEvent = events.find((event) => event.type === 'dice_roll_resolved');
    assert.ok(diceEvent);
    assert.equal(diceEvent.chatSessionId, chatSessionId);
    assert.equal(diceEvent.turnId, 'turn_nested_dice_progress');
    assert.equal(diceEvent.toolId, 'game.dice.check');
  } finally {
    dataManager.close();
  }
});

test('runtime publishes one meaningful combat settlement notice per resolved action', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
  const character = appDatabase.importCharacterCard(card);
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Combat Settlement Notice Test',
    includeGreeting: false
  }).session;
  const runtime = new AgentChatRuntime({ chatProvider: new MockChatProvider(), dataManager, appDatabase });
  try {
    const tools = runtime.toolPluginManager;
    await tools.executeTool('system.npc_state.patch_state', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      npcId: 'pc_arin',
      actorType: 'player',
      isPlayer: true,
      name: 'Arin',
      values: { hp: 10, maxHp: 10, speed: 30 }
    }, undefined, { chatSessionId: chat.id });
    await tools.executeTool('system.npc_state.patch_state', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      npcId: 'npc_guard',
      actorType: 'npc',
      name: 'Guard',
      values: { hp: 12, maxHp: 12 }
    }, undefined, { chatSessionId: chat.id });
    await tools.executeTool('system.resources.reset_action_economy', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      npcId: 'pc_arin',
      movementMax: 30
    }, undefined, { chatSessionId: chat.id });
    await tools.executeTool('system.combat.start_battle', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      battleId: 'battle_arena',
      name: 'Arena Fight',
      participantIds: ['pc_arin', 'npc_guard'],
      allyIds: ['pc_arin'],
      enemyIds: ['npc_guard']
    }, undefined, { chatSessionId: chat.id });

    const eventCountBeforeAction = runtime.listAgentProgressEvents({ chatSessionId: chat.id }).length;
    await tools.executeTool('system.combat.resolve_action', {
      chatSessionId: chat.id,
      sceneId: 'arena',
      battleId: 'battle_arena',
      actorId: 'pc_arin',
      targetId: 'npc_guard',
      hitResult: { outcome: 'hit', hit: true },
      damage: [{ type: 'slashing', amount: 5 }]
    }, undefined, { chatSessionId: chat.id });

    const settlementEvents = runtime.listAgentProgressEvents({ chatSessionId: chat.id })
      .slice(eventCountBeforeAction)
      .filter((event) => event.type === 'settlement_changed');
    assert.equal(settlementEvents.length, 1);
    assert.equal(settlementEvents[0].toolId, 'system.combat.resolve_action');
    assert.match(settlementEvents[0].settlementNotice.text, /造成 5 点伤害/);
    assert.match(settlementEvents[0].settlementNotice.detail, /HP 12 -> 7/);
    assert.equal(settlementEvents.some((event) => event.toolId === 'system.effects.apply_settlement'), false);
    assert.equal(settlementEvents.some((event) => event.toolId === 'system.resources.spend_action_economy'), false);
  } finally {
    dataManager.close();
    appDatabase.close();
  }
});

test('runtime formats structured narrative JSON into player-facing chat text', () => {
  const content = extractAgentLoopAssistantContent({
    finalOutput: {
      narrative: {
        content: JSON.stringify({
          mapName: '旧酒馆',
          sceneDialogue: '雨水顺着窗棂往下淌，炉火把大厅照得发红。',
          npcs: [
            { name: '米拉', dialogue: '别在门口站太久，巡夜的人刚过去。' },
            { name: '酒保', action: '把一只缺口杯推到吧台边，装作没有看见你。' }
          ],
          narrator: '你可以继续询问米拉，也可以先查看吧台后的暗门。',
          actionResult: '你进入酒馆，没有触发新的战斗。',
          choices: ['询问米拉', '观察暗门']
        })
      }
    }
  });

  assert.equal(content, [
    '旧酒馆：雨水顺着窗棂往下淌，炉火把大厅照得发红。',
    '米拉：别在门口站太久，巡夜的人刚过去。',
    '酒保：把一只缺口杯推到吧台边，装作没有看见你。',
    '旁白：你可以继续询问米拉，也可以先查看吧台后的暗门。',
    '行动结果：你进入酒馆，没有触发新的战斗。',
    '接下来：询问米拉 / 观察暗门'
  ].join('\n'));
});

test('app chat creation binds a unique player actor before writing protagonist greeting', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-runtime-protagonist-greeting-'));
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const appDatabase = new AppDatabase({
    databasePath: ':memory:',
    chatDataDirectory: join(directory, 'chat-data')
  });
  const character = appDatabase.importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Campaign GM',
      first_mes: '这条角色卡 greeting 不应该被 app chat 主角开场使用。'
    }
  });
  appDatabase.saveInitialSetting(character.id, playerActorInitialSetting([
    {
      id: 'state_pc_arin',
      sceneId: 'current',
      npcId: 'pc_arin',
      name: 'Arin',
      actorType: 'player',
      isPlayer: true,
      playerId: 'player_1',
      greeting: '我在雨停后的旧市场醒来，握紧了银钥匙。'
    }
  ]));
  const runtime = new AgentChatRuntime({
    chatProvider: new MockChatProvider(),
    dataManager,
    appDatabase,
    worldline: { databasePath: ':memory:', trace: false },
    scene: false,
    toolTrace: false
  });

  try {
    const created = await runtime.createAppChatSession({
      characterCardId: character.id,
      title: 'Bound Greeting',
      userName: 'Player',
      includeGreeting: true
    });

    assert.equal(created.initialization.status, 'bound');
    assert.equal(created.initialization.actorId, 'pc_arin');
    assert.equal(created.greeting.status, 'created');
    assert.equal(created.session.messages.length, 1);
    assert.equal(created.session.messages[0].role, 'user');
    assert.equal(created.session.messages[0].name, 'Arin');
    assert.equal(created.session.messages[0].content, '我在雨停后的旧市场醒来，握紧了银钥匙。');
    assert.equal(created.session.messages[0].metadata.greetingSource, 'initialization.selected');
    assert.equal(created.session.messages[0].metadata.protagonistGreeting, true);
    assert.equal(created.session.messages[0].metadata.protagonist.actorId, 'pc_arin');

    const context = await runtime.executeTool('system.actor_control.get_context', {
      chatSessionId: created.session.id
    });
    assert.equal(context.output.context.controlledActorId, 'pc_arin');
    assert.equal(context.output.context.source, 'app-initializer');

    const protagonist = await runtime.executeTool('system.protagonist.get_active', {
      chatSessionId: created.session.id
    });
    assert.equal(protagonist.output.active.data.activeActorId, 'pc_arin');

    const states = await runtime.executeTool('system.npc_state.list_states', {
      chatSessionId: created.session.id,
      isProtagonist: true
    });
    assert.equal(states.output.records.length, 1);
    assert.equal(states.output.records[0].data.npcId, 'pc_arin');
  } finally {
    dataManager.close();
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('app chat creation leaves opening unfixed when bound protagonist has no database greeting', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-runtime-protagonist-no-greeting-'));
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const appDatabase = new AppDatabase({
    databasePath: ':memory:',
    chatDataDirectory: join(directory, 'chat-data')
  });
  const character = appDatabase.importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Campaign GM',
      first_mes: '角色卡开场不应兜底。'
    }
  });
  appDatabase.saveInitialSetting(character.id, playerActorInitialSetting([
    {
      id: 'state_pc_arin',
      sceneId: 'current',
      npcId: 'pc_arin',
      name: 'Arin',
      actorType: 'player',
      isPlayer: true,
      playerId: 'player_1'
    }
  ]));
  const runtime = new AgentChatRuntime({
    chatProvider: new MockChatProvider(),
    dataManager,
    appDatabase,
    worldline: { databasePath: ':memory:', trace: false },
    scene: false,
    toolTrace: false
  });

  try {
    const created = await runtime.createAppChatSession({
      characterCardId: character.id,
      title: 'No Fixed Greeting',
      userName: 'Player',
      includeGreeting: true
    });

    assert.equal(created.initialization.status, 'bound');
    assert.equal(created.greeting.status, 'skipped');
    assert.equal(created.greeting.reason, 'missing_protagonist_greeting');
    assert.equal(created.session.messages.length, 0);
  } finally {
    dataManager.close();
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('app chat creation can auto-bind one active protagonist among multiple player actors', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-runtime-protagonist-marker-'));
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const appDatabase = new AppDatabase({
    databasePath: ':memory:',
    chatDataDirectory: join(directory, 'chat-data')
  });
  const character = appDatabase.importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Campaign GM'
    }
  });
  appDatabase.saveInitialSetting(character.id, playerActorInitialSetting([
    {
      id: 'state_pc_arin',
      sceneId: 'current',
      npcId: 'pc_arin',
      name: 'Arin',
      actorType: 'player',
      isPlayer: true,
      playerId: 'player_1'
    },
    {
      id: 'state_pc_mira',
      sceneId: 'current',
      npcId: 'pc_mira',
      name: 'Mira',
      actorType: 'player',
      isPlayer: true,
      isProtagonist: true,
      playerId: 'player_2',
      greeting: '我是米拉，我正站在旧钟楼前。'
    }
  ]));
  const runtime = new AgentChatRuntime({
    chatProvider: new MockChatProvider(),
    dataManager,
    appDatabase,
    worldline: { databasePath: ':memory:', trace: false },
    scene: false,
    toolTrace: false
  });

  try {
    const created = await runtime.createAppChatSession({
      characterCardId: character.id,
      title: 'Marked Protagonist',
      userName: 'Player',
      includeGreeting: true
    });

    assert.equal(created.initialization.status, 'bound');
    assert.equal(created.initialization.actorId, 'pc_mira');
    assert.equal(created.session.messages.length, 1);
    assert.equal(created.session.messages[0].name, 'Mira');
    assert.equal(created.session.messages[0].content, '我是米拉，我正站在旧钟楼前。');
  } finally {
    dataManager.close();
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('app chat creation refuses to guess when multiple player actors exist', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-runtime-multiple-protagonists-'));
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const appDatabase = new AppDatabase({
    databasePath: ':memory:',
    chatDataDirectory: join(directory, 'chat-data')
  });
  const character = appDatabase.importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Campaign GM',
      first_mes: '开场白不应该在未选主角时出现。'
    }
  });
  appDatabase.saveInitialSetting(character.id, playerActorInitialSetting([
    {
      id: 'state_pc_arin',
      sceneId: 'current',
      npcId: 'pc_arin',
      name: 'Arin',
      actorType: 'player',
      isPlayer: true,
      playerId: 'player_1'
    },
    {
      id: 'state_pc_mira',
      sceneId: 'current',
      npcId: 'pc_mira',
      name: 'Mira',
      actorType: 'player',
      isPlayer: true,
      playerId: 'player_2'
    }
  ]));
  const runtime = new AgentChatRuntime({
    chatProvider: new MockChatProvider(),
    dataManager,
    appDatabase,
    worldline: { databasePath: ':memory:', trace: false },
    scene: false,
    toolTrace: false
  });

  try {
    const created = await runtime.createAppChatSession({
      characterCardId: character.id,
      title: 'Needs Selection',
      userName: 'Player',
      includeGreeting: true
    });

    assert.equal(created.initialization.status, 'requires_selection');
    assert.equal(created.initialization.reason, 'multiple_player_actors');
    assert.equal(created.greeting.status, 'skipped');
    assert.equal(created.greeting.reason, 'missing_bound_protagonist');
    assert.equal(created.session.messages.length, 0);

    const context = await runtime.executeTool('system.actor_control.get_context', {
      chatSessionId: created.session.id
    });
    assert.equal(context.output.context.requiresInitialization, true);
    assert.equal(context.output.context.controlledActorId, '');
  } finally {
    dataManager.close();
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('app chat agent loop resolves the latest active scene before building narrative prompt', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-runtime-active-scene-'));
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const appDatabase = new AppDatabase({
    databasePath: ':memory:',
    chatDataDirectory: join(directory, 'chat-data')
  });
  const chatProvider = new CapturingChatProvider('旧市场：你看见旧商贩守在银钥匙摊位旁。');
  const character = appDatabase.importCharacterCard(card);
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Active Scene Prompt Test',
    includeGreeting: false
  }).session;
  const runtime = new AgentChatRuntime({
    chatProvider,
    dataManager,
    appDatabase,
    worldline: {
      databasePath: ':memory:',
      trace: false
    },
    scene: {
      trace: false
    },
    toolTrace: false
  });

  try {
    await runtime.executeTool('system.scene_manager.enter_scene', {
      chatSessionId: chat.id,
      sceneId: 'old_market',
      title: '旧市场',
      summary: '旧市场里银钥匙交易传闻很活跃。',
      maps: [{
        mapId: 'old_market_map',
        name: '旧市场北街',
        summary: '银钥匙摊位在北侧拱廊下。'
      }],
      npcs: [{
        npcId: 'old_vendor',
        name: '旧商贩',
        summary: '知道银钥匙摊位的真实主人。'
      }]
    }, undefined, {
      chatSessionId: chat.id,
      authorization: true
    });

    const result = await runtime.sendAppChatMessage(chat.id, '我观察旧市场。', {
      source: 'test.active-scene'
    });
    const promptText = chatProvider.calls.at(-1).messages.map((message) => message.content).join('\n');

    assert.equal(result.agentLoop.sceneId, 'old_market');
    assert.equal(result.assistantMessage.metadata.agentLoop.sceneId, 'old_market');
    assert.match(promptText, /sceneId["\s:]+old_market|sceneId: old_market/);
    assert.match(promptText, /旧市场北街/);
    assert.match(promptText, /银钥匙摊位在北侧拱廊下/);
    assert.match(promptText, /旧商贩/);
    assert.match(promptText, /知道银钥匙摊位的真实主人/);
  } finally {
    dataManager.close();
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('runtime publishes adjudication after fixed dice progress for action resolver', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
  const character = appDatabase.importCharacterCard(card);
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Adjudication Progress Test',
    includeGreeting: false
  }).session;
  const runtime = new AgentChatRuntime({ chatProvider: new MockChatProvider(), dataManager, appDatabase });
  try {
    const chatSessionId = chat.id;
    await runtime.toolPluginManager.executeTool('system.action.resolve', {
      chatSessionId,
      sceneId: 'current',
      sourceText: '我强行推开石门。',
      dryRun: false,
      plan: {
        actionId: 'act_force_stone_door',
        sourceText: '我强行推开石门。',
        intent: {
          label: 'force_open',
          summary: '用力量推开石门。'
        },
        checks: [
          {
            id: 'strength_check',
            tool: 'game.dice.check',
            input: {
              successThreshold: 14,
              diceCount: 1,
              diceSides: 20,
              modifier: 2,
              forceMode: 'success'
            },
            metadata: {
              ability: 'strength',
              reason: '石门沉重但没有锁死。'
            }
          }
        ],
        proposals: []
      }
    }, undefined, {
      chatSessionId,
      turnId: 'turn_adjudication_progress',
      authorization: true
    });

    const events = runtime.listAgentProgressEvents({ chatSessionId });
    const diceIndex = events.findIndex((event) => event.type === 'dice_roll_resolved');
    const adjudicationIndex = events.findIndex((event) => event.type === 'adjudication_resolved');
    assert.ok(diceIndex >= 0);
    assert.ok(adjudicationIndex >= 0);
    assert.ok(diceIndex < adjudicationIndex);
    const adjudication = events[adjudicationIndex].adjudication;
    assert.equal(adjudication.toolId, 'system.action.resolve');
    assert.equal(adjudication.appealAvailable, true);
    assert.equal(adjudication.resolution.checks[0].threshold, 14);
    assert.equal(adjudication.resolution.checks[0].modifierTotal, 2);
    assert.equal(adjudication.resolution.checks[0].modifierSources[0].name, '固定修正');
    assert.equal(adjudication.resolution.diceTotals[0].success, true);
  } finally {
    dataManager.close();
    appDatabase.close();
  }
});

test('runtime publishes adjudication progress for persuasion resolver', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
  const character = appDatabase.importCharacterCard(card);
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Persuasion Adjudication Progress Test',
    includeGreeting: false
  }).session;
  const runtime = new AgentChatRuntime({ chatProvider: new MockChatProvider(), dataManager, appDatabase });
  try {
    await runtime.toolPluginManager.executeTool('system.persuasion.resolve', {
      chatSessionId: chat.id,
      sceneId: 'current',
      sourceText: '我说服守卫放行。',
      targetNpcId: 'npc_guard',
      successThreshold: 15,
      diceSides: 20,
      diceCount: 1,
      forceMode: 'success',
      judgement: {
        status: 'judged',
        reasoningQuality: 'strong',
        argumentBonus: 3,
        dcAdjustment: 0,
        summary: 'The player gives a concrete reason and avoids threats.'
      }
    }, undefined, {
      turnId: 'turn_persuasion_adjudication_progress'
    });

    const events = runtime.listAgentProgressEvents({ chatSessionId: chat.id });
    const diceEvent = events.find((event) => event.type === 'dice_roll_resolved');
    const adjudicationEvent = events.find((event) => event.type === 'adjudication_resolved' && event.toolId === 'system.persuasion.resolve');
    assert.ok(diceEvent);
    assert.ok(adjudicationEvent);
    assert.equal(adjudicationEvent.turnId, 'turn_persuasion_adjudication_progress');
    assert.equal(adjudicationEvent.adjudication.appealAvailable, false);
    assert.equal(adjudicationEvent.adjudication.resolution.intent.label, '说服');
    assert.equal(adjudicationEvent.adjudication.resolution.checks[0].threshold, 15);
  } finally {
    dataManager.close();
    appDatabase.close();
  }
});

test('runtime injects structured interface prompt and updates state from model output', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-runtime-structured-'));
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const structuredInterfaceStore = new StructuredInterfaceStateStore({
    directory: join(directory, 'state'),
    trace: {
      directory: join(directory, 'traces')
    }
  });
  const runtime = new AgentChatRuntime({
    chatProvider: new StructuredMockProvider(),
    dataManager,
    structuredInterfaceStore
  });

  try {
    const session = await runtime.createSession({
      characterCard: card,
      userName: 'Player',
      structuredInterface: {
        enabled: true,
        initialState: {
          sceneMap: {
            title: '门外'
          },
          statusBar: {
            characters: [{ id: 'pc', name: 'Player', hp: 10, maxHp: 10 }]
          }
        }
      }
    });
    const result = await runtime.sendMessage(session.id, 'I enter the tower.', {
      includePrompt: true
    });

    assert.match(result.prompt.messages.map((message) => message.content).join('\n'), /Structured Interface State/);
    assert.equal(result.assistantMessage.content, '你推开门，钟楼门厅的灰尘被脚步搅起。');
    assert.equal(result.structuredInterface.updated, true);
    assert.equal(result.structuredInterface.state.sceneMap.title, '旧钟楼门厅');
    assert.equal(result.structuredInterface.state.statusBar.characters[0].hp, 8);
    assert.equal(result.structuredInterface.trace.operation, 'apply-model-output');
    assert.equal(result.structuredInterface.promptTrace.operation, 'build-prompt');
    assert.ok(result.session.metadata.structuredInterface.filePath.endsWith(`${session.id}.json`));
  } finally {
    dataManager.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('runtime routes OpenAI-compatible local provider aliases', async () => {
  const originalFetch = globalThis.fetch;
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = {
      url: String(url),
      body: JSON.parse(init.body)
    };
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: 'vLLM alias response.'
        }
      }]
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  try {
    const runtime = new AgentChatRuntime({ chatProvider: new MockChatProvider(), dataManager });
    const session = await runtime.createSession({ characterCard: card, userName: 'Player' });
    const result = await runtime.sendMessage(session.id, 'I inspect the door.', {
      api: {
        provider: 'vllm',
        model: 'served-model'
      },
      temperature: 0.4,
      maxTokens: 123
    });

    assert.equal(captured.url, 'http://127.0.0.1:8000/v1/chat/completions');
    assert.equal(captured.body.model, 'served-model');
    assert.equal(captured.body.temperature, 0.4);
    assert.equal(captured.body.max_tokens, 123);
    assert.equal(result.assistantMessage.content, 'vLLM alias response.');
  } finally {
    globalThis.fetch = originalFetch;
    dataManager.close();
  }
});

test('runtime sends Ollama native chat requests', async () => {
  const originalFetch = globalThis.fetch;
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = {
      url: String(url),
      body: JSON.parse(init.body)
    };
    return new Response(JSON.stringify({
      message: {
        role: 'assistant',
        content: 'Ollama native response.'
      },
      done: true
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  try {
    const runtime = new AgentChatRuntime({ chatProvider: new MockChatProvider(), dataManager });
    const session = await runtime.createSession({ characterCard: card, userName: 'Player' });
    const result = await runtime.sendMessage(session.id, 'I inspect the door.', {
      api: {
        provider: 'ollama',
        model: 'llama3.2'
      },
      temperature: 0.2,
      maxTokens: 64
    });

    assert.equal(captured.url, 'http://127.0.0.1:11434/api/chat');
    assert.equal(captured.body.model, 'llama3.2');
    assert.equal(captured.body.stream, false);
    assert.equal(captured.body.options.temperature, 0.2);
    assert.equal(captured.body.options.num_predict, 64);
    assert.ok(captured.body.messages.every((message) => !Object.hasOwn(message, 'name')));
    assert.equal(result.assistantMessage.content, 'Ollama native response.');
  } finally {
    globalThis.fetch = originalFetch;
    dataManager.close();
  }
});

class CapturingChatProvider {
  constructor(content = 'Captured response.') {
    this.content = content;
    this.calls = [];
  }

  async generate(request) {
    this.calls.push(request);
    return {
      content: this.content,
      raw: {
        provider: 'capturing-mock'
      }
    };
  }
}

function playerActorInitialSetting(seedRecords = []) {
  return {
    version: '1',
    collections: [
      {
        name: 'npc_structured_states',
        fields: [
          { name: 'sceneId', type: 'text' },
          { name: 'npcId', type: 'text', required: true },
          { name: 'name', type: 'text' },
          { name: 'actorType', type: 'text' },
          { name: 'isPlayer', type: 'boolean' },
          { name: 'isProtagonist', type: 'boolean' },
          { name: 'playerId', type: 'text' },
          { name: 'greeting', type: 'text' },
          { name: 'statusBar', type: 'json' },
          { name: 'resources', type: 'json' }
        ],
        seedRecords
      }
    ]
  };
}

class StructuredMockProvider {
  async generate({ messages }) {
    const joined = messages.map((message) => message.content).join('\n');
    assert.match(joined, /AI_DND_STRUCTURED_STATE/);
    return {
      content: [
        '你推开门，钟楼门厅的灰尘被脚步搅起。',
        '<AI_DND_STRUCTURED_STATE>',
        JSON.stringify({
          mode: 'patch',
          sceneMap: {
            title: '旧钟楼门厅',
            currentAreaId: 'foyer',
            areas: [{ id: 'foyer', name: '门厅', discovered: true }]
          },
          statusBar: {
            characters: [{ id: 'pc', hp: 8, conditions: ['擦伤'] }]
          },
          skillBar: {
            skills: [{ id: 'listen', name: '聆听', ready: true }]
          }
        }),
        '</AI_DND_STRUCTURED_STATE>'
      ].join('\n'),
      raw: {
        provider: 'structured-mock'
      }
    };
  }
}
