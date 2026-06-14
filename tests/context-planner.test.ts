// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppDatabase,
  RagService,
  SQLiteDataManager,
  createDefaultToolPluginManager
} from '../src/index.js';

function createTestWorld() {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-context-planner-'));
  const appDatabase = new AppDatabase({
    databasePath: ':memory:',
    chatDataDirectory: join(directory, 'chat-data')
  });
  const dataManager = new SQLiteDataManager({
    databasePath: ':memory:',
    schemaDirectory: null
  });
  const runtimeRagService = new RagService({
    defaultCollection: 'runtime-default',
    chunkSize: 80,
    overlap: 10
  });
  const permanentRagService = new RagService({
    defaultCollection: 'permanent-default',
    chunkSize: 80,
    overlap: 10
  });
  const character = appDatabase.importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Context GM',
      first_mes: 'Begin.'
    }
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Context Planner Test',
    includeGreeting: false
  }).session;
  const tools = createDefaultToolPluginManager({
    appDatabase,
    dataManager,
    ragService: runtimeRagService,
    permanentRagService,
    trace: {
      enabled: false,
      contextPlanner: {
        directory: join(directory, 'context-planner-traces')
      }
    }
  });
  return {
    directory,
    appDatabase,
    dataManager,
    runtimeRagService,
    permanentRagService,
    character,
    chat,
    tools
  };
}

async function seedContext(world) {
  const { appDatabase, chat, tools, permanentRagService } = world;
  const messages = [
    appDatabase.addChatMessage(chat.id, {
      role: 'user',
      name: 'Player',
      content: '我答应米拉去旧市场找银钥匙。'
    }),
    appDatabase.addChatMessage(chat.id, {
      role: 'assistant',
      name: 'Context GM',
      content: '米拉让你避开男爵的巡逻队。'
    })
  ];

  await tools.executeTool('system.scene_npcs.mount_npc', {
    chatSessionId: chat.id,
    sceneId: 'old_market',
    npcId: 'npc_mira',
    name: '米拉',
    role: '委托人',
    importance: 'major',
    status: 'present',
    summary: '米拉知道银钥匙可能被藏在旧市场钟楼附近。'
  });
  await tools.executeTool('system.npc_state.patch_state', {
    chatSessionId: chat.id,
    sceneId: 'old_market',
    npcId: 'npc_mira',
    name: '米拉',
    values: { trust: 72, suspicion: 12 },
    specialStatuses: [{ id: 'urgent', name: '焦急', active: true }]
  });
  await tools.executeTool('system.scene_maps.mount_map', {
    chatSessionId: chat.id,
    sceneId: 'old_market',
    mapId: 'map_old_market',
    name: '旧市场',
    type: 'district',
    status: 'active',
    summary: '旧市场有钟楼、蓝色摊棚和通向井底的暗巷。'
  });
  await tools.executeTool('system.map_state.patch_state', {
    chatSessionId: chat.id,
    sceneId: 'old_market',
    mapId: 'map_old_market',
    name: '旧市场',
    areas: [{ id: 'bell_tower', name: '钟楼', status: 'visible' }],
    objects: [{ id: 'blue_stall', name: '蓝色摊棚', status: 'unchecked' }],
    values: { alert: 2 }
  });
  await tools.executeTool('system.quests.upsert_quest', {
    chatSessionId: chat.id,
    questId: 'silver_key',
    title: '银钥匙',
    status: 'tracked',
    objective: '找到银钥匙并确认它是否能打开钟楼下的密门。',
    successCriteria: ['找到银钥匙', '确认密门用途'],
    difficultyHint: 'moderate',
    riskHint: 'patrols'
  });
  await tools.executeTool('system.chat_compression.upsert_summary', {
    chatSessionId: chat.id,
    type: 'segment_summary',
    title: '米拉的委托',
    summary: '玩家答应米拉寻找银钥匙，并暂时对男爵保密。',
    sourceMessageIds: messages.map((message) => message.id),
    importance: 0.9
  });
  await tools.executeTool('system.character_memory.upsert_memory', {
    chatSessionId: chat.id,
    characterId: 'npc_mira',
    name: '米拉',
    memoryType: 'promise',
    summary: '玩家承诺会帮米拉寻找银钥匙，并避开男爵巡逻。',
    importance: 0.9,
    visibility: 'private'
  });
  await permanentRagService.ingestText({
    collection: 'lore',
    sourceId: 'old-market-lore',
    text: '旧市场钟楼下面有一扇银钥匙才能打开的密门。男爵不知道这条路。'
  });
  await tools.executeTool('system.rag_runtime.remember', {
    collection: 'runtime-default',
    sourceId: 'runtime-market-note',
    text: '本轮场景中，蓝色摊棚附近有人提到井底暗巷。'
  });
}

test('context planner builds a budgeted prompt context from scene, memory, RAG, and recent messages', async () => {
  const world = createTestWorld();
  try {
    await seedContext(world);

    const described = await world.tools.executeTool('system.context_planner.describe_planner', {});
    assert.equal(described.output.noLlm, true);
    assert.ok(described.output.sources.some((source) => source.id === 'permanent.rag'));

    const planned = await world.tools.executeTool('system.context_planner.plan_context', {
      chatSessionId: world.chat.id,
      sceneId: 'old_market',
      query: '米拉 银钥匙 旧市场 钟楼',
      permanentRagCollection: 'lore',
      minScore: 0,
      maxContextTokens: 3500,
      includeNpcProfiles: false
    });

    const output = planned.output;
    const sectionIds = output.selectedSections.map((section) => section.id);
    assert.ok(sectionIds.includes('scene.npcs'));
    assert.ok(sectionIds.includes('current.map'));
    assert.ok(sectionIds.includes('current.quests'));
    assert.ok(sectionIds.includes('character.memory'));
    assert.ok(sectionIds.includes('permanent.rag'));
    assert.ok(sectionIds.includes('runtime.rag'));
    assert.ok(sectionIds.includes('recent.messages'));
    assert.ok(sectionIds.includes('chat.compression'));
    assert.match(output.promptContext, /AI_DND_CONTEXT_PLAN/);
    assert.match(output.promptContext, /米拉/);
    assert.match(output.promptContext, /银钥匙/);
    assert.match(output.promptContext, /旧市场/);
    assert.equal(output.policy.noLlm, true);
    assert.equal(existsSync(output.trace.files.input), true);
    assert.equal(existsSync(output.trace.files.prompt), true);
  } finally {
    world.appDatabase.close();
    world.dataManager.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('context planner binds short escape input to recent NPC tracking instead of stale combat states', async () => {
  const world = createTestWorld();
  try {
    world.appDatabase.addChatMessage(world.chat.id, {
      role: 'user',
      name: 'Player',
      content: '我打两只低级妖兽。'
    });
    world.appDatabase.addChatMessage(world.chat.id, {
      role: 'assistant',
      name: 'Context GM',
      content: '妖兽1和妖兽2还留在旧战斗记录里。'
    });
    world.appDatabase.addChatMessage(world.chat.id, {
      role: 'user',
      name: 'Player',
      content: '我跟踪炼丹师白芷，保持距离观察她去哪里。'
    });

    await world.tools.executeTool('system.npc_state.patch_state', {
      chatSessionId: world.chat.id,
      sceneId: 'old_market',
      npcId: 'enemy_beast_1',
      name: '妖兽1',
      actorType: 'monster',
      values: { hp: 8, maxHp: 8 }
    });

    const planned = await world.tools.executeTool('system.context_planner.plan_context', {
      chatSessionId: world.chat.id,
      sceneId: 'old_market',
      currentInput: '我要逃跑。',
      query: '我要逃跑。',
      maxContextTokens: 2400
    });

    assert.ok(planned.output.selectedSections.some((section) => section.id === 'turn.focus'));
    assert.match(planned.output.promptContext, /<AI_DND_TURN_FOCUS>/);
    assert.match(planned.output.promptContext, /foregroundKind: tracking/);
    assert.match(planned.output.promptContext, /foregroundTargetCandidates: 白芷/);
    assert.match(planned.output.promptContext, /olderCombatHint: 我打两只低级妖兽/);
    assert.equal(planned.output.sources.collectedCounts['scene.npcs.suppressedCombatStates'], 1);
    assert.doesNotMatch(planned.output.promptContext, /"name": "妖兽1"/);
  } finally {
    world.appDatabase.close();
    world.dataManager.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('context planner reports omitted sections when the context budget is tight', async () => {
  const world = createTestWorld();
  try {
    await seedContext(world);

    const planned = await world.tools.executeTool('system.context_planner.plan_context', {
      chatSessionId: world.chat.id,
      sceneId: 'old_market',
      query: '米拉 银钥匙 旧市场 钟楼',
      permanentRagCollection: 'lore',
      minScore: 0,
      maxContextTokens: 120,
      includeNpcProfiles: false
    });

    assert.ok(planned.output.usage.selectedTokens <= 120);
    assert.ok(planned.output.omittedSections.length > 0);
    assert.ok(planned.output.omittedSections.some((section) => section.reason === 'budget_exhausted'));
  } finally {
    world.appDatabase.close();
    world.dataManager.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('context planner resolves requested L0 profile level from NPC registry', async () => {
  const world = createTestWorld();
  try {
    await seedContext(world);

    await world.tools.executeTool('system.npc_registry.upsert_npc', {
      id: 'npc_mira',
      name: '米拉',
      role: '银钥匙委托人',
      importance: 'major',
      summary: 'L0 Registry: 米拉是旧市场银钥匙线索的委托人。'
    }, undefined, {
      authorization: true
    });
    await world.tools.executeTool('system.npc_profiles.upsert_profile', {
      npcId: 'npc_mira',
      level: 'L1',
      name: '米拉',
      summary: 'L1 Profile: 米拉谨慎、焦急，并害怕男爵巡逻。'
    }, undefined, {
      authorization: true
    });

    const planned = await world.tools.executeTool('system.context_planner.plan_context', {
      chatSessionId: world.chat.id,
      sceneId: 'old_market',
      query: '米拉',
      maxContextTokens: 2200,
      includeNpcProfiles: true,
      includeNpcStates: false,
      includeCurrentMap: false,
      includeQuests: false,
      includeCharacterMemory: false,
      includePermanentRag: false,
      includeRuntimeRag: false,
      includeRecentMessages: false,
      includeCompression: false
    });

    assert.equal(planned.output.sources.collectedCounts['scene.npcs.profileLevels.L0'], 1);
    assert.equal(planned.output.sources.collectedCounts['scene.npcs.profileLevels.database'], 1);
    assert.match(planned.output.promptContext, /L0 Registry/);
    assert.match(planned.output.promptContext, /L1 Profile/);
    assert.doesNotMatch(JSON.stringify(planned.output.sources.errors), /L0/);
  } finally {
    world.appDatabase.close();
    world.dataManager.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});
