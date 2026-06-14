// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AgentChatRuntime,
  AppDatabase,
  NpcRegistry,
  RagLayerManager,
  RagService,
  SQLiteDataManager
} from '../src/index.js';

const card = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Lifecycle GM',
    first_mes: 'Begin.'
  }
};

test('character-scoped non-empty data is cloned per chat and chat edits do not modify the original', async () => {
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:', schemaDirectory: null });
  const runtime = new AgentChatRuntime({
    appDatabase,
    dataManager,
    ragService: new RagService(),
    trace: false
  });
  const registry = new NpcRegistry({ dataManager, appDatabase });

  try {
    const character = appDatabase.importCharacterCard(card);
    appDatabase.switchCharacterCard(character.id);
    const original = registry.upsertNpc({
      id: 'guard',
      name: 'Guard',
      summary: 'Original guard profile.'
    });
    assert.equal(original.data.lifecycleScope, 'character');
    assert.equal(original.data.lifecycleClonePolicy, 'copy_to_chat');

    const firstChat = appDatabase.createChatSession({
      characterCardId: character.id,
      includeGreeting: false
    }).session;
    const firstClone = await runtime.cloneAppChatResources(firstChat.id);
    assert.equal(firstClone.data.cloned.length, 1);

    const visibleInFirst = registry.getNpc('guard');
    assert.equal(visibleInFirst.data.lifecycleScope, 'chat');
    assert.equal(visibleInFirst.data.lifecycleCloneOf, 'guard');

    registry.patchNpc('guard', { summary: 'Changed only in first chat.' });
    assert.equal(registry.getNpc('guard').data.summary, 'Changed only in first chat.');
    assert.equal(dataManager.getRecord('npc_registry', 'guard').data.summary, 'Original guard profile.');

    const secondChat = appDatabase.createChatSession({
      characterCardId: character.id,
      includeGreeting: false
    }).session;
    await runtime.cloneAppChatResources(secondChat.id);
    const visibleInSecond = registry.getNpc('guard');
    assert.equal(visibleInSecond.data.lifecycleScope, 'chat');
    assert.equal(visibleInSecond.data.summary, 'Original guard profile.');
  } finally {
    appDatabase.close();
    dataManager.close();
  }
});

test('generic data manager redirects active-chat edits to cloned working copies', () => {
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
  const dataManager = new SQLiteDataManager({
    databasePath: ':memory:',
    schemaDirectory: null,
    appDatabase
  });

  try {
    const character = appDatabase.importCharacterCard(card);
    appDatabase.switchCharacterCard(character.id);
    const original = dataManager.upsertRecord('faction_relations', {
      id: 'rel1',
      factionA: 'guild',
      factionB: 'crown',
      tension: 1
    }, { id: 'rel1' });
    assert.equal(original.data.lifecycleScope, 'character');

    const chat = appDatabase.createChatSession({
      characterCardId: character.id,
      includeGreeting: false
    }).session;
    const cloned = dataManager.upsertRecord('faction_relations', {
      id: 'rel1',
      factionA: 'guild',
      factionB: 'crown',
      tension: 2
    }, { id: 'rel1' });

    assert.notEqual(cloned.id, 'rel1');
    assert.equal(cloned.data.lifecycleScope, 'chat');
    assert.equal(cloned.data.lifecycleCloneOf, 'rel1');
    assert.equal(cloned.data.chatSessionId, chat.id);
    assert.equal(dataManager.getRecord('faction_relations', 'rel1').data.tension, 1);
  } finally {
    appDatabase.close();
    dataManager.close();
  }
});

test('generic character-scoped data records are cloned for new chats', async () => {
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
  const dataManager = new SQLiteDataManager({
    databasePath: ':memory:',
    schemaDirectory: null,
    appDatabase
  });
  const runtime = new AgentChatRuntime({
    appDatabase,
    dataManager,
    ragService: new RagService(),
    trace: false
  });

  try {
    const character = appDatabase.importCharacterCard(card);
    appDatabase.switchCharacterCard(character.id);
    dataManager.upsertRecord('map_routes', {
      id: 'route1',
      fromMapId: 'town',
      toMapId: 'well',
      status: 'open'
    }, { id: 'route1' });

    const chat = appDatabase.createChatSession({
      characterCardId: character.id,
      includeGreeting: false
    }).session;
    const cloned = await runtime.cloneAppChatResources(chat.id);
    assert.equal(cloned.data.cloned.length, 1);
    assert.equal(cloned.data.cloned[0].collection, 'map_routes');
    assert.equal(cloned.data.cloned[0].record.data.lifecycleScope, 'chat');
  } finally {
    appDatabase.close();
    dataManager.close();
  }
});

test('character-scoped rag is cloned into chat working memory', async () => {
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:', schemaDirectory: null });
  const permanentRagService = new RagService({
    defaultCollection: 'lore',
    chunkSize: 200,
    overlap: 0
  });
  const runtime = new AgentChatRuntime({
    appDatabase,
    dataManager,
    ragService: new RagService(),
    permanentRagService,
    trace: false
  });
  const ragLayers = new RagLayerManager({
    permanentRagService,
    appDatabase
  });

  try {
    const character = appDatabase.importCharacterCard(card);
    appDatabase.switchCharacterCard(character.id);
    await ragLayers.importPermanentFile({
      collection: 'lore',
      sourceId: 'well-rumor',
      text: '井底原始设定：井底藏着一扇银门。',
      characterCardId: character.id
    });

    const chat = appDatabase.createChatSession({
      characterCardId: character.id,
      includeGreeting: false
    }).session;
    const cloned = await runtime.cloneAppChatResources(chat.id);
    assert.equal(cloned.permanentRag.cloned.length, 1);

    const searched = await ragLayers.searchPermanent({
      collection: 'lore',
      query: '井底有什么',
      chatSessionId: chat.id,
      characterCardId: character.id,
      minScore: 0
    });
    assert.equal(searched.hits.length, 1);
    assert.equal(searched.hits[0].metadata.lifecycleScope, 'chat');
    assert.equal(searched.hits[0].metadata.lifecycleCloneOf, 'well-rumor#1');
  } finally {
    appDatabase.close();
    dataManager.close();
  }
});
