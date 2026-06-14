// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentChatRuntime,
  AppDatabase,
  AuditLog,
  MockChatProvider,
  SQLiteDataManager
} from '../src/index.js';

const card = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Mira',
    first_mes: 'Ready.'
  }
};

function createRuntime(options = {}) {
  const auditLog = new AuditLog({ databasePath: ':memory:', trace: false });
  const runtime = new AgentChatRuntime({
    chatProvider: new MockChatProvider(),
    auditLog,
    worldline: {
      databasePath: ':memory:',
      trace: false
    },
    ...options
  });
  return { runtime, auditLog };
}

test('worldline savepoint restores runtime messages and runtime RAG memory', async () => {
  const { runtime, auditLog } = createRuntime();
  const session = await runtime.createSession({ characterCard: card, userName: 'Player' });

  await runtime.sendMessage(session.id, 'First path.');
  await runtime.ingestMemory({
    collection: session.collection,
    sourceId: 'before-note',
    text: 'The silver path is open.'
  });
  const savedSession = await runtime.getSession(session.id);
  const savepoint = await runtime.createWorldlineSavepoint({
    runtimeSessionId: session.id,
    label: 'Before wrong turn',
    runtimeRagCollections: [session.collection]
  });

  const branchResult = await runtime.createWorldlineBranch({
    fromSavepointId: savepoint.id,
    name: 'Wrong turn branch',
    switchTo: true
  });
  assert.equal(branchResult.branch.active, true);

  await runtime.sendMessage(session.id, 'Wrong turn.');
  await runtime.ingestMemory({
    collection: session.collection,
    sourceId: 'after-note',
    text: 'The red path collapses.'
  });
  assert.ok((await runtime.getSession(session.id)).messages.length > savedSession.messages.length);

  const restored = await runtime.restoreWorldlineSavepoint(savepoint.id, {
    actor: 'tester',
    reason: 'reject branch'
  });
  assert.equal(restored.restored, true);
  assert.equal((await runtime.getSession(session.id)).messages.length, savedSession.messages.length);

  const hits = await runtime.retrieveMemory({
    collection: session.collection,
    query: 'red path silver path',
    minScore: -1,
    limit: 10
  });
  assert.equal(hits.some((doc) => doc.metadata.sourceId === 'before-note'), true);
  assert.equal(hits.some((doc) => doc.metadata.sourceId === 'after-note'), false);

  const llmEvents = runtime.listAuditEvents({ operation: 'runtime.send_message' });
  assert.equal(llmEvents.some((event) => event.metadata.worldlineBranchId === branchResult.branch.id), true);
  auditLog.close();
});

test('worldline savepoint restores app chat messages and chat data database', async () => {
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const character = appDatabase.importCharacterCard(card);
  appDatabase.registerCharacterDataSchema(character.id, {
    collections: [
      {
        name: 'actors',
        fields: [
          { name: 'hp', type: 'integer' },
          { name: 'status', type: 'text' }
        ]
      }
    ]
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    includeGreeting: false
  }).session;
  const { runtime, auditLog } = createRuntime({ appDatabase, dataManager });

  runtime.addAppChatMessage(chat.id, {
    role: 'user',
    content: 'Start.'
  });
  appDatabase.upsertChatDataRecord(chat.id, 'actors', {
    id: 'pc',
    hp: 10,
    status: 'ready'
  });
  dataManager.upsertRecord('quest_notes', {
    id: 'quest-before',
    summary: 'Original scoped quest note.',
    lifecycleManaged: true,
    lifecycleScope: 'chat',
    lifecycleLevel: 'L1',
    characterCardId: character.id,
    chatSessionId: chat.id
  });

  const savepoint = await runtime.createWorldlineSavepoint({
    appChatSessionId: chat.id,
    label: 'Clean app state',
    includeRuntimeRag: false
  });

  appDatabase.updateChatSession(chat.id, { title: 'Wrong title' });
  runtime.addAppChatMessage(chat.id, {
    role: 'assistant',
    content: 'Rejected generation.'
  });
  appDatabase.patchChatDataRecord(chat.id, 'actors', 'pc', {
    hp: 1,
    status: 'bad'
  });
  dataManager.patchRecord('quest_notes', 'quest-before', {
    summary: 'Corrupted scoped quest note.'
  });
  dataManager.upsertRecord('generated_maps', {
    id: 'map-after',
    title: 'Should vanish after restore.',
    lifecycleManaged: true,
    lifecycleScope: 'chat',
    lifecycleLevel: 'L1',
    characterCardId: character.id,
    chatSessionId: chat.id
  });

  const restored = await runtime.restoreWorldlineSavepoint(savepoint.id, { actor: 'tester' });
  const restoredChat = appDatabase.getChatSession(chat.id, {
    includeMessages: false,
    includeCharacter: false,
    includeDataDatabase: false
  });
  const messages = appDatabase.listChatMessages(chat.id);
  const actor = appDatabase.getChatDataRecord(chat.id, 'actors', 'pc');
  const quest = dataManager.getRecord('quest_notes', 'quest-before');
  assert.equal(restoredChat.title, 'Mira Chat');
  assert.equal(messages.length, 1);
  assert.equal(actor.data.hp, 10);
  assert.equal(actor.data.status, 'ready');
  assert.equal(quest.data.summary, 'Original scoped quest note.');
  assert.equal(dataManager.hasCollection('generated_maps'), false);
  assert.equal(restored.result.appChatSession.messages, undefined);
  assert.equal(restored.result.appChatMessages.restoredMessages.length, 1);

  appDatabase.close();
  dataManager.close();
  auditLog.close();
});

test('worldline tools require authorization for destructive restore and switch', async () => {
  const { runtime, auditLog } = createRuntime();
  const session = await runtime.createSession({ characterCard: card, userName: 'Player' });
  const saved = await runtime.executeTool('system.worldline.create_savepoint', {
    runtimeSessionId: session.id,
    label: 'Tool savepoint'
  });

  await assert.rejects(
    () => runtime.executeTool('system.worldline.restore_savepoint', {
      id: saved.output.id
    }),
    /requires explicit user authorization/
  );

  const restored = await runtime.executeTool('system.worldline.restore_savepoint', {
    id: saved.output.id
  }, {
    authorization: true
  });
  assert.equal(restored.output.restored, true);

  auditLog.close();
});
