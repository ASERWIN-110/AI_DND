// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAP_REGISTRY_PLUGIN,
  MapRegistry,
  SQLiteDataManager,
  ToolPluginManager,
  createMapRegistryHandlers
} from '../src/index.js';

test('map registry imports and exports L0 map entries from formatted documents', () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const registry = new MapRegistry({ dataManager });

  try {
    const imported = registry.importDocument({
      format: 'yaml',
      source: 'test-fixture',
      text: [
        'maps:',
        '  - id: old_market',
        '    name: 旧市场',
        '    type: district',
        '    parentMapId: silver_fog_port',
        '    tags: [market, key]',
        '    summary: 银钥匙可能藏在蓝色摊棚附近。',
        '    npcRefs: [npc_mira]',
        '  - id: blue_stall',
        '    name: 蓝色摊棚',
        '    type: room',
        '    parentMapId: old_market',
        '    tags: [stall, clue]'
      ].join('\n')
    });

    assert.equal(imported.count, 2);
    assert.equal(registry.getMap('old_market').data.parentMapId, 'silver_fog_port');
    assert.equal(registry.getMap('old_market').data.npcRefs[0], 'npc_mira');

    const listed = registry.listMaps({ tags: ['market'], query: '银钥匙' });
    assert.equal(listed.records.length, 1);
    assert.equal(listed.records[0].id, 'old_market');

    const exported = registry.exportDocument({ format: 'json' });
    assert.equal(exported.payload.maps.length, 2);
    assert.match(exported.text, /blue_stall/);
  } finally {
    dataManager.close();
  }
});

test('map registry tools require user authorization for writes', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const registry = new MapRegistry({ dataManager });
  const manager = new ToolPluginManager({ trace: false });
  manager.createPlugin(MAP_REGISTRY_PLUGIN, {
    handlers: createMapRegistryHandlers({ registry })
  });

  try {
    await assert.rejects(
      () => manager.executeTool('system.map_registry.upsert_map', {
        id: 'old_market',
        name: '旧市场',
        type: 'district'
      }),
      /requires explicit user authorization/
    );

    const authorized = await manager.executeTool('system.map_registry.upsert_map', {
      id: 'old_market',
      name: '旧市场',
      type: 'district',
      tags: ['market']
    }, undefined, {
      authorization: true
    });
    assert.equal(authorized.output.id, 'old_market');

    const read = await manager.executeTool('system.map_registry.list_maps', {
      tags: ['market']
    });
    assert.equal(read.output.records.length, 1);

    await assert.rejects(
      () => manager.executeTool('system.map_registry.delete_map', { id: 'old_market' }),
      /requires explicit user authorization/
    );
  } finally {
    dataManager.close();
  }
});
