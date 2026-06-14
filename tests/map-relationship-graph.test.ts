// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppDatabase,
  MapRelationshipGraph,
  SQLiteDataManager,
  createDefaultToolPluginManager
} from '../src/index.js';

function createTestChat() {
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
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
    title: 'Map Relationship Test',
    includeGreeting: false
  }).session;
  return { appDatabase, chat };
}

test('map relationship graph imports, exports, traverses, and avoids blocked paths by default', () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const graph = new MapRelationshipGraph({ dataManager });

  try {
    const imported = graph.importDocument({
      format: 'yaml',
      text: [
        'mapRelationshipGraph:',
        '  nodes:',
        '    - mapId: old_market',
        '      name: Old Market',
        '      type: district',
        '    - mapId: north_gate',
        '      name: North Gate',
        '      type: gate',
        '    - mapId: watch_tower',
        '      name: Watch Tower',
        '      type: landmark',
        '  edges:',
        '    - id: market_to_gate',
        '      fromMapId: old_market',
        '      toMapId: north_gate',
        '      relationType: road',
        '      cost: 2',
        '    - id: gate_to_tower',
        '      fromMapId: north_gate',
        '      toMapId: watch_tower',
        '      relationType: stairs',
        '      cost: 2',
        '    - id: collapsed_shortcut',
        '      fromMapId: old_market',
        '      toMapId: watch_tower',
        '      relationType: shortcut',
        '      status: blocked',
        '      cost: 0.1'
      ].join('\n')
    });

    assert.equal(imported.nodes.count, 3);
    assert.equal(imported.edges.count, 3);

    const found = graph.findPath({
      startMapId: 'old_market',
      targetMapId: 'watch_tower'
    });
    assert.equal(found.found, true);
    assert.deepEqual(found.pathMapIds, ['old_market', 'north_gate', 'watch_tower']);
    assert.equal(found.totalCost, 4);

    const blockedAllowed = graph.findPath({
      startMapId: 'old_market',
      targetMapId: 'watch_tower',
      includeBlocked: true
    });
    assert.deepEqual(blockedAllowed.pathEdgeIds, ['collapsed_shortcut']);

    const traversed = graph.traverseMap({
      startMapId: 'old_market',
      maxDepth: 2
    });
    assert.equal(traversed.visitedMapIds.includes('watch_tower'), true);

    const exported = graph.exportDocument({ format: 'json' });
    assert.match(exported.text, /watch_tower/);
  } finally {
    dataManager.close();
  }
});

test('map relationship tools merge scene mounts and map_state routes for scene movement pathfinding', async () => {
  const { appDatabase, chat } = createTestChat();
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const manager = createDefaultToolPluginManager({
    appDatabase,
    dataManager,
    trace: false
  });

  try {
    await assert.rejects(
      () => manager.executeTool('system.map_relationships.upsert_edge', {
        id: 'unauthorized_edge',
        fromMapId: 'old_market',
        toMapId: 'north_gate'
      }),
      /requires explicit user authorization/i
    );

    await manager.executeTool('system.map_relationships.upsert_edge', {
      id: 'global_gate_to_tower',
      fromMapId: 'north_gate',
      toMapId: 'watch_tower',
      relationType: 'stairs',
      cost: 2
    }, undefined, {
      authorization: true
    });

    await manager.executeTool('system.scene_maps.mount_map', {
      chatSessionId: chat.id,
      sceneId: 'current',
      mapId: 'old_market',
      name: 'Old Market',
      status: 'active'
    });
    await manager.executeTool('system.scene_maps.mount_map', {
      chatSessionId: chat.id,
      sceneId: 'current',
      mapId: 'north_gate',
      name: 'North Gate',
      parentMapId: 'old_market',
      status: 'active'
    });

    await manager.executeTool('system.map_state.patch_state', {
      chatSessionId: chat.id,
      sceneId: 'current',
      mapId: 'old_market',
      name: 'Old Market',
      areas: [
        { id: 'square', name: 'Market Square', discovered: true },
        { id: 'alley', name: 'North Alley', discovered: true }
      ],
      routes: [
        { id: 'square_to_alley', fromAreaId: 'square', toAreaId: 'alley', status: 'open', cost: 1 }
      ],
      exits: [
        { id: 'alley_to_gate', fromAreaId: 'alley', toMapId: 'north_gate', status: 'open', cost: 1 },
        { id: 'collapsed_tower_shortcut', fromAreaId: 'square', toMapId: 'watch_tower', status: 'blocked', cost: 0.1 }
      ]
    });

    const sceneGraph = await manager.executeTool('system.map_relationships.build_scene_graph', {
      chatSessionId: chat.id,
      sceneId: 'current'
    });
    assert.equal(sceneGraph.output.sources.includes('scene_map_mounts'), true);
    assert.equal(sceneGraph.output.sources.includes('map_structured_states'), true);
    assert.equal(sceneGraph.output.nodes.some((node) => node.id === 'old_market:square'), true);

    const found = await manager.executeTool('system.map_relationships.find_scene_path', {
      chatSessionId: chat.id,
      sceneId: 'current',
      startMapId: 'old_market:square',
      targetMapId: 'watch_tower'
    });

    assert.equal(found.output.found, true);
    assert.deepEqual(found.output.pathMapIds, [
      'old_market:square',
      'old_market:alley',
      'north_gate',
      'watch_tower'
    ]);
    assert.equal(found.output.pathEdgeIds.includes('state-exit:mapstate_current_old_market:collapsed_tower_shortcut'), false);
    assert.equal(found.output.mode, 'scene');
  } finally {
    appDatabase.close();
    dataManager.close();
  }
});
