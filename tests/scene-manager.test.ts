// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentChatRuntime,
  AppDatabase,
  MockChatProvider,
  RagService,
  SceneManager,
  SQLiteDataManager,
  StructuredInterfaceStateStore
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
      name: 'Test GM',
      first_mes: 'Begin.'
    }
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Scene Manager Test',
    includeGreeting: false
  }).session;
  return { appDatabase, character, chat };
}

test('scene manager enters and ends a scene across mounts, RAG, time, UI, and compression', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-scene-manager-'));
  const { appDatabase, chat } = createTestChat({ chatDataDirectory: join(directory, 'chat-data') });
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const ragService = new RagService({ defaultCollection: 'scene-notes' });
  const structuredInterfaceStore = new StructuredInterfaceStateStore({
    directory: join(directory, 'structured'),
    trace: {
      directory: join(directory, 'structured-traces')
    }
  });
  const scenes = new SceneManager({
    appDatabase,
    dataManager,
    runtimeRagService: ragService,
    structuredInterfaceStore,
    trace: {
      directory: join(directory, 'scene-traces')
    }
  });

  try {
    await ragService.ingestText({
      collection: 'scene-notes',
      sourceId: 'bell-note',
      text: '旧钟楼门厅里有银铃线索，守卫不愿主动提起。'
    });

    const entered = await scenes.enterScene({
      chatSessionId: chat.id,
      sceneId: 'tower_gate',
      title: '旧钟楼门厅',
      summary: '玩家刚进入钟楼门厅。',
      maps: [
        { mapId: 'tower_foyer', name: '钟楼门厅', summary: '铜门、灰尘、通向楼梯的拱门。' }
      ],
      npcs: [
        { npcId: 'gate_guard', name: '门厅守卫', role: 'guard', status: 'present' }
      ],
      rag: {
        queries: ['银铃 守卫 钟楼'],
        runtimeCollections: ['scene-notes'],
        minScore: -1
      },
      time: {
        events: [
          { eventId: 'bell', title: '银铃响起', afterSeconds: 60 }
        ]
      },
      structuredSessionId: 'runtime-scene-1'
    });

    assert.equal(entered.scene.data.status, 'active');
    assert.equal(entered.mountedMaps[0].data.mapId, 'tower_foyer');
    assert.equal(entered.mountedNpcs[0].data.name, '门厅守卫');
    assert.equal(entered.ragContext.runtime[0].hits.some((hit) => hit.metadata.sourceId === 'bell-note'), true);
    assert.equal(entered.time.clock.data.sceneId, 'tower_gate');
    assert.equal(entered.time.events[0].data.eventId, 'bell');
    assert.equal(structuredInterfaceStore.load('runtime-scene-1').state.sceneMap.title, '旧钟楼门厅');
    assert.equal(existsSync(entered.trace.files.input), true);

    const promptContext = scenes.buildScenePromptContext({
      chatSessionId: chat.id,
      sceneId: 'tower_gate'
    });
    assert.match(promptContext.prompt, /门厅守卫/);
    assert.match(promptContext.prompt, /银铃/);

    const ended = await scenes.endScene({
      chatSessionId: chat.id,
      sceneId: 'tower_gate',
      summary: '玩家在门厅确认了银铃线索。',
      facts: ['门厅守卫知道银铃线索。']
    });
    assert.equal(ended.scene.data.status, 'ended');
    assert.equal(ended.memory.record.data.type, 'scene_summary');
    assert.equal(ended.unmountedNpcs.mode, 'markDeparted');
    assert.equal(scenes.sceneNpcs.listMountedNpcs({
      chatSessionId: chat.id,
      sceneId: 'tower_gate'
    }).records.length, 0);
    assert.equal(scenes.sceneMaps.listMountedMaps({
      chatSessionId: chat.id,
      sceneId: 'tower_gate'
    }).records.length, 0);
  } finally {
    dataManager.close();
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('scene manager tool is registered on the runtime and writes chat-local scene records', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-scene-tool-'));
  const { appDatabase, chat } = createTestChat({ chatDataDirectory: join(directory, 'chat-data') });
  const runtime = new AgentChatRuntime({
    chatProvider: new MockChatProvider(),
    appDatabase,
    dataManager: new SQLiteDataManager({ databasePath: ':memory:' }),
    worldline: {
      databasePath: ':memory:',
      trace: false
    },
    scene: {
      trace: {
        enabled: false,
        directory: join(directory, 'scene-traces')
      }
    },
    toolTrace: false
  });

  try {
    const entered = await runtime.executeTool('system.scene_manager.enter_scene', {
      chatSessionId: chat.id,
      sceneId: 'market',
      title: '旧市场',
      maps: ['old_market'],
      npcs: ['old_vendor'],
      time: {
        initializeClock: true
      }
    });
    assert.equal(entered.output.scene.data.sceneId, 'market');
    assert.equal(entered.output.mountedMaps[0].data.mapId, 'old_market');

    const listed = await runtime.executeTool('system.scene_manager.list_scenes', {
      chatSessionId: chat.id,
      status: 'active'
    });
    assert.equal(listed.output.records.length, 1);

    const exported = await runtime.executeTool('system.scene_manager.export_document', {
      chatSessionId: chat.id,
      format: 'yaml'
    });
    assert.match(exported.output.text, /scenes:/);
  } finally {
    runtime.dataManager.close();
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
