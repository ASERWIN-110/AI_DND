// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppDatabase,
  NPC_REGISTRY_PLUGIN,
  NpcRegistry,
  SCENE_NPC_PLUGIN,
  SceneNpcMountManager,
  SQLiteDataManager,
  ToolPluginManager,
  createNpcRegistryHandlers,
  createSceneNpcHandlers
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
    title: 'Scene NPC Test',
    includeGreeting: false
  }).session;
  return { appDatabase, character, chat };
}

test('scene NPC mounts live in the chat data database and hydrate from registry', () => {
  const { appDatabase, chat } = createTestChat();
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const registry = new NpcRegistry({ dataManager });
  const sceneNpcs = new SceneNpcMountManager({ appDatabase, npcRegistry: registry });

  registry.upsertNpc({
    id: 'npc_mira',
    name: 'Mira',
    role: 'investigator mage',
    importance: 'major',
    tags: ['mage', 'silver-mist'],
    profileRef: 'profiles/npc_mira.json',
    summary: 'A silver-mist investigator with unfinished business.',
    portraitUrl: '/assets/npcs/mira.webp'
  });

  const mounted = sceneNpcs.mountNpc({
    chatSessionId: chat.id,
    sceneId: 'bell_tower',
    npcId: 'npc_mira',
    locationLabel: 'balcony',
    disposition: 'ally'
  });
  assert.equal(mounted.data.name, 'Mira');
  assert.equal(mounted.data.profileRef, 'profiles/npc_mira.json');
  assert.equal(mounted.data.sceneId, 'bell_tower');
  assert.equal(mounted.data.metadata.portraitUrl, '/assets/npcs/mira.webp');

  const listed = sceneNpcs.listMountedNpcs({
    chatSessionId: chat.id,
    sceneId: 'bell_tower',
    tags: ['mage'],
    query: 'mira'
  });
  assert.equal(listed.records.length, 1);

  const patched = sceneNpcs.patchMountedNpc({
    chatSessionId: chat.id,
    sceneId: 'bell_tower',
    npcId: 'npc_mira',
    patch: {
      status: 'hidden',
      visibility: 'hidden',
      summary: 'Watching the tower door from the balcony.'
    }
  });
  assert.equal(patched.data.status, 'hidden');

  const exported = sceneNpcs.exportDocument({
    chatSessionId: chat.id,
    sceneId: 'bell_tower',
    format: 'json'
  });
  assert.equal(exported.payload.sceneNpcs.length, 1);
  assert.match(exported.text, /Watching the tower door/);

  const removed = sceneNpcs.unmountNpc({
    chatSessionId: chat.id,
    sceneId: 'bell_tower',
    npcId: 'npc_mira'
  });
  assert.equal(removed.deleted, true);

  dataManager.close();
  appDatabase.close();
});

test('scene NPC tools support automatic chat-scoped CRUD without registry authorization', async () => {
  const { appDatabase, chat } = createTestChat();
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const manager = new ToolPluginManager({ trace: false });
  manager.createPlugin(NPC_REGISTRY_PLUGIN, {
    handlers: createNpcRegistryHandlers({ dataManager })
  });
  manager.createPlugin(SCENE_NPC_PLUGIN, {
    handlers: createSceneNpcHandlers({ appDatabase, dataManager })
  });

  await manager.executeTool('system.npc_registry.upsert_npc', {
    id: 'npc_guard',
    name: 'Gate Guard',
    role: 'guard',
    tags: ['guard']
  }, undefined, {
    authorization: true
  });

  const mounted = await manager.executeTool('system.scene_npcs.mount_npc', {
    chatSessionId: chat.id,
    sceneId: 'gate',
    npcId: 'npc_guard',
    status: 'present',
    avatarUrl: '/assets/npcs/gate_guard.png'
  });
  assert.equal(mounted.output.data.name, 'Gate Guard');
  assert.equal(mounted.output.data.metadata.avatarUrl, '/assets/npcs/gate_guard.png');

  const listed = await manager.executeTool('system.scene_npcs.list_mounted_npcs', {
    chatSessionId: chat.id,
    sceneId: 'gate',
    tags: ['guard']
  });
  assert.equal(listed.output.records.length, 1);

  const departed = await manager.executeTool('system.scene_npcs.unmount_npc', {
    chatSessionId: chat.id,
    sceneId: 'gate',
    npcId: 'npc_guard',
    mode: 'markDeparted'
  });
  assert.equal(departed.output.deleted, false);
  assert.equal(departed.output.record.data.status, 'departed');

  const exported = await manager.executeTool('system.scene_npcs.export_document', {
    chatSessionId: chat.id,
    sceneId: 'gate',
    format: 'yaml'
  });
  assert.match(exported.output.text, /sceneNpcs:/);

  dataManager.close();
  appDatabase.close();
});

test('scene NPC mounts can be imported from formatted documents', () => {
  const { appDatabase, chat } = createTestChat();
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const sceneNpcs = new SceneNpcMountManager({ appDatabase, dataManager });

  const imported = sceneNpcs.importDocument({
    chatSessionId: chat.id,
    sceneId: 'market',
    format: 'yaml',
    text: [
      'sceneNpcs:',
      '  - npcId: npc_vendor',
      '    name: Old Vendor',
      '    role: merchant',
      '    tags: [merchant, market]',
      '    status: present',
      '  - name: 神秘斗篷人',
      '    role: watcher',
      '    visibility: hidden'
    ].join('\n')
  });

  assert.equal(imported.count, 2);
  const listed = sceneNpcs.listMountedNpcs({
    chatSessionId: chat.id,
    sceneId: 'market',
    includeInactive: true
  });
  assert.equal(listed.records.length, 2);
  assert.equal(listed.records[1].data.sceneId, 'market');

  dataManager.close();
  appDatabase.close();
});
