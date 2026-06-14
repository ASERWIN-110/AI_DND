// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppDatabase,
  MAP_REGISTRY_PLUGIN,
  MapRegistry,
  SCENE_MAP_PLUGIN,
  SceneMapMountManager,
  SQLiteDataManager,
  ToolPluginManager,
  createMapRegistryHandlers,
  createSceneMapHandlers
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
    title: 'Scene Map Test',
    includeGreeting: false
  }).session;
  return { appDatabase, chat };
}

test('scene map mounts live in chat data database and hydrate from map registry', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-scene-maps-'));
  const { appDatabase, chat } = createTestChat({ chatDataDirectory: directory });
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const registry = new MapRegistry({ dataManager });
  registry.upsertMap({
    id: 'old_market',
    name: '旧市场',
    type: 'district',
    tags: ['market', 'key'],
    summary: '旧市场有蓝色摊棚和银钥匙线索。',
    backgroundUrl: '/assets/maps/old_market.jpg'
  });
  const sceneMaps = new SceneMapMountManager({
    appDatabase,
    mapRegistry: registry
  });

  try {
    const mounted = sceneMaps.mountMap({
      chatSessionId: chat.id,
      sceneId: 'current',
      mapId: 'old_market',
      status: 'active',
      visibility: 'visible',
      orderIndex: 1
    });
    assert.equal(mounted.id, 'scenemap_current_old_market');
    assert.equal(mounted.data.name, '旧市场');
    assert.equal(mounted.data.summary, '旧市场有蓝色摊棚和银钥匙线索。');
    assert.equal(mounted.data.tags.includes('market'), true);
    assert.equal(mounted.data.metadata.backgroundUrl, '/assets/maps/old_market.jpg');

    const listed = sceneMaps.listMountedMaps({
      chatSessionId: chat.id,
      sceneId: 'current',
      query: '银钥匙'
    });
    assert.equal(listed.records.length, 1);

    const described = sceneMaps.describe(chat.id);
    assert.equal(described.collection.collection, 'scene_map_mounts');
    assert.ok(described.collection.formatFile.endsWith('scene_map_mounts.schema.json'));
  } finally {
    appDatabase.close();
    dataManager.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('scene map tools support automatic chat-scoped CRUD without registry authorization', async () => {
  const { appDatabase, chat } = createTestChat();
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const registry = new MapRegistry({ dataManager });
  const sceneMaps = new SceneMapMountManager({
    appDatabase,
    mapRegistry: registry
  });
  const manager = new ToolPluginManager({ trace: false });
  manager.createPlugin(MAP_REGISTRY_PLUGIN, {
    handlers: createMapRegistryHandlers({ registry })
  });
  manager.createPlugin(SCENE_MAP_PLUGIN, {
    handlers: createSceneMapHandlers({ manager: sceneMaps })
  });

  try {
    await manager.executeTool('system.map_registry.upsert_map', {
      id: 'old_market',
      name: '旧市场',
      type: 'district',
      tags: ['market']
    }, undefined, {
      authorization: true
    });

    const mounted = await manager.executeTool('system.scene_maps.mount_map', {
      chatSessionId: chat.id,
      sceneId: 'current',
      mapId: 'old_market',
      locationLabel: '蓝色摊棚附近',
      backgroundUrl: '/assets/maps/old_market_gate.webp'
    });
    assert.equal(mounted.output.data.name, '旧市场');
    assert.equal(mounted.output.data.metadata.backgroundUrl, '/assets/maps/old_market_gate.webp');

    const patched = await manager.executeTool('system.scene_maps.patch_mounted_map', {
      chatSessionId: chat.id,
      sceneId: 'current',
      mapId: 'old_market',
      patch: {
        visibility: 'fogged',
        summary: '旧市场仍有未探索区域。'
      }
    });
    assert.equal(patched.output.data.visibility, 'fogged');

    const exported = await manager.executeTool('system.scene_maps.export_document', {
      chatSessionId: chat.id,
      sceneId: 'current',
      format: 'json'
    });
    assert.match(exported.output.text, /old_market/);

    const unmounted = await manager.executeTool('system.scene_maps.unmount_map', {
      chatSessionId: chat.id,
      sceneId: 'current',
      mapId: 'old_market',
      mode: 'markInactive'
    });
    assert.equal(unmounted.output.mode, 'markInactive');
  } finally {
    appDatabase.close();
    dataManager.close();
  }
});
