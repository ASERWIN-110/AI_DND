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

test('runtime sendMessage records prompt/output audit and can rollback generated messages', async () => {
  const auditLog = new AuditLog({ databasePath: ':memory:', trace: false });
  const runtime = new AgentChatRuntime({
    chatProvider: new MockChatProvider(),
    auditLog
  });

  const session = await runtime.createSession({ characterCard: card, userName: 'Player' });
  const initialCount = session.messages.length;
  const result = await runtime.sendMessage(session.id, 'Open the old door.');

  assert.equal(result.session.messages.length, initialCount + 2);
  const events = runtime.listAuditEvents({ operation: 'runtime.send_message' });
  assert.equal(events.length, 1);
  assert.equal(events[0].reversible, true);
  assert.equal(events[0].output.assistantMessage.id, result.assistantMessage.id);
  assert.ok(events[0].output.prompt.messages.length > 0);

  const rollback = await runtime.rollbackAuditEvent(events[0].id, { actor: 'tester' });
  assert.equal(rollback.rolledBack, true);
  const restored = await runtime.getSession(session.id);
  assert.equal(restored.messages.length, initialCount);
  assert.equal(runtime.getAuditEvent(events[0].id).revertedBy, 'tester');

  auditLog.close();
});

test('tool execution audit snapshots global data and supports rollback and replay', async () => {
  const auditLog = new AuditLog({ databasePath: ':memory:', trace: false });
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:', schemaDirectory: null });
  const runtime = new AgentChatRuntime({
    chatProvider: new MockChatProvider(),
    dataManager,
    auditLog,
    toolTrace: false
  });

  await runtime.executeTool('system.data.semantic_update', {
    collection: 'actors',
    id: 'pc',
    values: { hp: 7 },
    storeRawText: false
  });
  assert.equal(dataManager.getRecord('actors', 'pc').data.hp, 7);

  const event = runtime.listAuditEvents({ operation: 'tool.execute' })[0];
  assert.equal(event.metadata.toolId, 'system.data.semantic_update');
  assert.equal(event.reversible, true);

  await runtime.rollbackAuditEvent(event.id, { actor: 'tester' });
  assert.equal(dataManager.queryRecords('actors').records.length, 0);

  const replay = await runtime.replayAuditEvent(event.id, { actor: 'tester' });
  assert.equal(replay.replayed, true);
  assert.equal(dataManager.getRecord('actors', 'pc').data.hp, 7);

  dataManager.close();
  auditLog.close();
});

test('rag ingest audit can rollback by source id', async () => {
  const auditLog = new AuditLog({ databasePath: ':memory:', trace: false });
  const runtime = new AgentChatRuntime({
    chatProvider: new MockChatProvider(),
    auditLog
  });

  await runtime.ingestMemory({
    collection: 'runtime-notes',
    sourceId: 'tower-note',
    text: 'The tower door opens only for a silver key.'
  });
  const before = await runtime.retrieveMemory({
    collection: 'runtime-notes',
    query: 'silver key',
    minScore: -1
  });
  assert.ok(before.length > 0);

  const event = runtime.listAuditEvents({ operation: 'rag.ingest' })[0];
  assert.equal(event.metadata.sourceId, 'tower-note');
  await runtime.rollbackAuditEvent(event.id, { actor: 'tester' });

  const after = await runtime.retrieveMemory({
    collection: 'runtime-notes',
    query: 'silver key',
    minScore: -1
  });
  assert.equal(after.length, 0);

  auditLog.close();
});

test('app chat message truncation records reversible audit event', async () => {
  const auditLog = new AuditLog({ databasePath: ':memory:', trace: false });
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
  const runtime = new AgentChatRuntime({
    chatProvider: new MockChatProvider(),
    appDatabase,
    auditLog
  });
  const character = appDatabase.importCharacterCard(card);
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    includeGreeting: false
  }).session;
  const first = runtime.addAppChatMessage(chat.id, {
    role: 'user',
    content: 'Hello.'
  }).message;
  runtime.addAppChatMessage(chat.id, {
    role: 'assistant',
    content: 'Bad generation.'
  });

  const truncated = runtime.deleteAppChatMessagesAfter(chat.id, {
    messageId: first.id,
    actor: 'tester'
  });
  assert.equal(truncated.deletedMessages.length, 1);
  assert.equal(appDatabase.listChatMessages(chat.id).length, 1);

  const event = runtime.listAuditEvents({ operation: 'app.chat.messages.delete_after' })[0];
  await runtime.rollbackAuditEvent(event.id, { actor: 'tester' });
  assert.equal(appDatabase.listChatMessages(chat.id).length, 2);

  appDatabase.close();
  auditLog.close();
});

test('app chat message edits are reversible through audit rollback', async () => {
  const auditLog = new AuditLog({ databasePath: ':memory:', trace: false });
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
  const runtime = new AgentChatRuntime({
    chatProvider: new MockChatProvider(),
    appDatabase,
    auditLog
  });
  const character = appDatabase.importCharacterCard(card);
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    includeGreeting: false
  }).session;
  const message = runtime.addAppChatMessage(chat.id, {
    role: 'user',
    content: 'Original line.'
  }).message;

  runtime.updateAppChatMessage(chat.id, message.id, {
    content: 'Edited line.'
  }, {
    actor: 'tester',
    reason: 'audit edit rollback test'
  });
  assert.equal(appDatabase.getChatMessage(message.id).content, 'Edited line.');

  const event = runtime.listAuditEvents({ operation: 'app.chat.message.update' })[0];
  assert.equal(event.reversible, true);
  await runtime.rollbackAuditEvent(event.id, { actor: 'tester' });
  assert.equal(appDatabase.getChatMessage(message.id).content, 'Original line.');

  appDatabase.close();
  auditLog.close();
});
