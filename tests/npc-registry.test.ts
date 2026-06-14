// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NPC_REGISTRY_PLUGIN,
  NpcRegistry,
  SQLiteDataManager,
  ToolPluginManager,
  createNpcRegistryHandlers
} from '../src/index.js';

test('npc registry imports and exports L0 entries from formatted documents', () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const registry = new NpcRegistry({ dataManager });

  const imported = registry.importDocument({
    format: 'yaml',
    source: 'test-fixture',
    text: [
      'npcs:',
      '  - id: npc_mira',
      '    name: Mira',
      '    role: investigator mage',
      '    importance: major',
      '    tags: [mage, silver-mist]',
      '    currentLocation: bell_tower',
      '    profileRef: profiles/npc_mira.json',
      '  - name: 港口守卫',
      '    role: guard',
      '    importance: minor',
      '    tags: [guard, harbor]'
    ].join('\n')
  });

  assert.equal(imported.count, 2);
  assert.equal(registry.getNpc('npc_mira').data.profileRef, 'profiles/npc_mira.json');

  const listed = registry.listNpcs({ tags: ['mage'], query: 'mira' });
  assert.equal(listed.records.length, 1);
  assert.equal(listed.records[0].id, 'npc_mira');

  const exported = registry.exportDocument({ format: 'json' });
  assert.equal(exported.payload.npcs.length, 2);
  assert.match(exported.text, /npc_mira/);

  dataManager.close();
});

test('npc registry tools require user authorization for writes', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const registry = new NpcRegistry({ dataManager });
  const manager = new ToolPluginManager({ trace: false });
  manager.createPlugin(NPC_REGISTRY_PLUGIN, {
    handlers: createNpcRegistryHandlers({ registry })
  });

  await assert.rejects(
    () => manager.executeTool('system.npc_registry.upsert_npc', {
      id: 'npc_mira',
      name: 'Mira',
      role: 'investigator',
      importance: 'major'
    }),
    /requires explicit user authorization/
  );

  const authorized = await manager.executeTool('system.npc_registry.upsert_npc', {
    id: 'npc_mira',
    name: 'Mira',
    role: 'investigator',
    importance: 'major',
    tags: ['mage']
  }, undefined, {
    authorization: {
      approved: true,
      reason: 'user confirmed NPC registry write'
    }
  });
  assert.equal(authorized.output.id, 'npc_mira');

  const read = await manager.executeTool('system.npc_registry.list_npcs', {
    tags: ['mage']
  });
  assert.equal(read.output.records.length, 1);

  await assert.rejects(
    () => manager.executeTool('system.npc_registry.delete_npc', { id: 'npc_mira' }),
    /requires explicit user authorization/
  );

  const deleted = await manager.executeTool('system.npc_registry.delete_npc', {
    id: 'npc_mira'
  }, undefined, {
    authorization: true
  });
  assert.equal(deleted.output.deleted, true);

  dataManager.close();
});
