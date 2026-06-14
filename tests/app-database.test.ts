// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppDatabase } from '../src/index.js';

const card = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Mira',
    description: 'A careful GM.',
    first_mes: 'The bronze door waits.',
    tags: ['gm', 'fantasy']
  }
};

test('app database imports and exports character cards', () => {
  const app = new AppDatabase({ databasePath: ':memory:' });

  const character = app.importCharacterCard(card, { source: 'test' });
  assert.equal(character.name, 'Mira');
  assert.equal(character.revisions.length, 1);
  assert.equal(character.currentRevision.data.first_mes, 'The bronze door waits.');

  const listed = app.listCharacterCards();
  assert.equal(listed.length, 1);

  const exported = app.exportCharacterCard(character.id);
  assert.equal(exported.spec, 'chara_card_v2');
  assert.equal(exported.data.name, 'Mira');

  const duplicate = app.importCharacterCard(card, { source: 'test' });
  assert.equal(duplicate.id, character.id);

  app.close();
});

test('app database manages multiple chats for the same character card', () => {
  const app = new AppDatabase({ databasePath: ':memory:' });
  const character = app.importCharacterCard(card);

  const first = app.createChatSession({
    characterCardId: character.id,
    title: 'Bell Tower',
    userName: 'Player'
  }).session;
  const second = app.createChatSession({
    characterCardId: character.id,
    title: 'Harbor',
    userName: 'Player',
    includeGreeting: false
  }).session;

  assert.equal(first.characterCardId, character.id);
  assert.equal(second.characterCardId, character.id);
  assert.equal(first.messages.length, 1);
  assert.equal(second.messages.length, 0);

  const userMessage = app.addChatMessage(first.id, {
    role: 'user',
    name: 'Player',
    content: 'I listen at the door.'
  });
  assert.equal(userMessage.orderIndex, 1);
  const editedMessage = app.updateChatMessage(first.id, userMessage.id, {
    content: 'I listen carefully at the door.'
  });
  assert.equal(editedMessage.content, 'I listen carefully at the door.');
  assert.ok(editedMessage.metadata.editedAt);
  const renamed = app.updateChatSession(first.id, { title: 'Bell Tower Renamed' });
  assert.equal(renamed.title, 'Bell Tower Renamed');

  const switched = app.switchChatSession(first.id);
  assert.equal(switched.active.chatSessionId, first.id);
  assert.equal(switched.session.characterCard.data.name, 'Mira');

  const chats = app.listChatSessions({ characterCardId: character.id });
  assert.equal(chats.length, 2);

  app.close();
});

test('app database updates, switches, archives, restores, and deletes character cards', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-character-lifecycle-'));
  let app;

  try {
    app = new AppDatabase({
      databasePath: join(directory, 'app.sqlite'),
      chatDataDirectory: join(directory, 'chat-databases')
    });
    const character = app.importCharacterCard(card);
    const updated = app.updateCharacterCard(character.id, {
      ...card,
      data: {
        ...card.data,
        name: 'Mira Revised',
        first_mes: 'A new opening.'
      }
    });
    assert.equal(updated.name, 'Mira Revised');
    assert.equal(updated.revisions.length, 2);
    assert.equal(app.exportCharacterCard(character.id).data.first_mes, 'A new opening.');

    const patched = app.patchCharacterCard(character.id, {
      description: 'Updated description.',
      tags: ['gm', 'updated']
    });
    assert.equal(patched.currentRevision.data.description, 'Updated description.');
    assert.deepEqual(patched.tags, ['gm', 'updated']);

    const first = app.createChatSession({
      characterCardId: character.id,
      title: 'First',
      includeGreeting: false
    }).session;
    const databasePath = first.dataDatabase.databasePath;
    assert.equal(existsSync(databasePath), true);

    const switched = app.switchCharacterCard(character.id);
    assert.equal(switched.active.characterCardId, character.id);
    assert.equal(switched.session.id, first.id);

    const archived = app.archiveCharacterCard(character.id);
    assert.equal(archived.archived, true);
    assert.equal(app.listCharacterCards().length, 0);
    assert.equal(app.listCharacterCards({ includeArchived: true }).length, 1);
    assert.equal(app.listChatSessions({ characterCardId: character.id }).length, 0);
    assert.equal(app.getActiveChatState(), undefined);

    const restored = app.restoreCharacterCard(character.id, { restoreChats: true });
    assert.equal(restored.restored, true);
    assert.equal(app.listCharacterCards().length, 1);
    assert.equal(app.listChatSessions({ characterCardId: character.id }).length, 1);

    const deleted = app.deleteCharacterCard(character.id);
    assert.equal(deleted.deleted, true);
    assert.equal(deleted.deletedChats.length, 1);
    assert.equal(deleted.deletedChats[0].dataDatabase.deleted, true);
    assert.equal(existsSync(databasePath), false);
    assert.throws(() => app.getCharacterCard(character.id), /Character card not found/);
  } finally {
    app?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('app database exports, imports, and deletes chat sessions', () => {
  const app = new AppDatabase({ databasePath: ':memory:' });
  const character = app.importCharacterCard(card);
  const session = app.createChatSession({
    characterCardId: character.id,
    title: 'Exported Chat',
    includeGreeting: false
  }).session;
  app.addChatMessage(session.id, {
    role: 'user',
    name: 'Player',
    content: 'Hello.'
  });
  app.addChatMessage(session.id, {
    role: 'assistant',
    name: 'Mira',
    content: 'Welcome.'
  });

  const exported = app.exportChatSession(session.id);
  assert.equal(exported.format, 'ai-dnd-chat-v1');
  assert.equal(exported.messages.length, 2);
  assert.equal(exported.characterCard.data.name, 'Mira');

  const imported = app.importChatSession(exported);
  assert.equal(imported.messages.length, 2);
  assert.equal(imported.characterCard.data.name, 'Mira');

  const deleted = app.deleteChatSession(session.id);
  assert.equal(deleted.deleted, true);
  assert.throws(() => app.getChatSession(session.id), /Chat session not found/);

  app.close();
});

test('chat data databases use character schemas with isolated per-chat records', () => {
  const app = new AppDatabase({ databasePath: ':memory:' });
  const character = app.importCharacterCard(card);
  const schema = app.registerCharacterDataSchema(character.id, {
    description: 'Runtime numeric state for this character card.',
    collections: [
      {
        name: 'actors',
        fields: [
          { name: 'hp', type: 'integer', required: true },
          { name: 'stress', type: 'number', defaultValue: 0 },
          { name: 'mood', type: 'text' },
          { name: 'flags', type: 'json' }
        ]
      }
    ]
  });
  assert.equal(schema.schema.collections[0].name, 'actors');

  const first = app.createChatSession({
    characterCardId: character.id,
    title: 'First State',
    includeGreeting: false
  }).session;
  const second = app.createChatSession({
    characterCardId: character.id,
    title: 'Second State',
    includeGreeting: false
  }).session;

  app.upsertChatDataRecord(first.id, 'actors', {
    id: 'pc',
    hp: '12',
    mood: 'wary',
    flags: { hidden: true }
  });
  app.upsertChatDataRecord(second.id, 'actors', {
    id: 'pc',
    hp: 3,
    mood: 'hurt'
  });
  app.patchChatDataRecord(second.id, 'actors', 'pc', { stress: '2.5' });

  assert.equal(app.getChatDataRecord(first.id, 'actors', 'pc').data.hp, 12);
  assert.equal(app.getChatDataRecord(first.id, 'actors', 'pc').data.stress, 0);
  assert.equal(app.getChatDataRecord(second.id, 'actors', 'pc').data.hp, 3);
  assert.equal(app.getChatDataRecord(second.id, 'actors', 'pc').data.stress, 2.5);

  assert.throws(() => app.upsertChatDataRecord(first.id, 'actors', {
    id: 'bad',
    hp: 'not-a-number'
  }), /integer/);
  assert.throws(() => app.upsertChatDataRecord(first.id, 'actors', {
    id: 'bad',
    hp: 1,
    unknown: true
  }), /not registered/);
  assert.throws(() => app.queryChatDataRecords(first.id, 'quests'), /not registered/);

  const switched = app.switchChatSession(first.id);
  assert.equal(switched.dataDatabase.active, true);
  assert.equal(switched.session.characterCard.data.name, 'Mira');

  app.close();
});

test('initial setting editor saves seed data and can reapply it to chats', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-initial-setting-'));
  let app;

  try {
    app = new AppDatabase({
      databasePath: join(directory, 'app.sqlite'),
      chatDataDirectory: join(directory, 'chat-databases')
    });
    const character = app.importCharacterCard(card);

    const preview = app.previewInitialSetting(character.id, {
      description: 'Game start data.',
      collections: [
        {
          name: 'actors',
          fields: [
            { name: 'hp', type: 'integer', required: true },
            { name: 'status', type: 'text', defaultValue: 'ready' },
            { name: 'flags', type: 'json' }
          ],
          seedRecords: [
            { id: 'pc', hp: '10', flags: { tutorial: true } }
          ]
        }
      ]
    });
    assert.equal(preview.validation.ok, true);
    assert.equal(preview.stats.seedRecordCount, 1);
    assert.equal(preview.initialSetting.collections[0].seedRecords[0].hp, 10);
    assert.equal(preview.initialSetting.collections[0].seedRecords[0].status, 'ready');
    assert.equal(preview.locations.characterSchema.table, 'character_data_schemas');
    assert.equal(preview.locations.characterSchema.column, 'schema_json');

    const dataFieldPreview = app.previewInitialSetting(character.id, {
      collections: [
        {
          name: 'profiles',
          fields: [
            { name: 'name', type: 'text' },
            { name: 'data', type: 'json' }
          ],
          seedRecords: [
            { id: 'npc_a', name: 'A', data: { sourceDirectory: 'chc/A' } }
          ]
        },
        {
          name: 'legacy_actors',
          fields: [
            { name: 'hp', type: 'integer' }
          ],
          seedRecords: [
            { id: 'legacy_pc', data: { hp: '7' } }
          ]
        }
      ]
    });
    assert.equal(dataFieldPreview.initialSetting.collections[0].seedRecords[0].name, 'A');
    assert.deepEqual(dataFieldPreview.initialSetting.collections[0].seedRecords[0].data, { sourceDirectory: 'chc/A' });
    assert.equal(dataFieldPreview.initialSetting.collections[1].seedRecords[0].hp, 7);

    const saved = app.saveInitialSetting(character.id, preview.initialSetting);
    assert.equal(saved.saved, true);
    assert.equal(saved.initialSetting.collections[0].seedRecords[0].id, 'pc');
    assert.equal(saved.locations.collections[0].characterSchema.jsonPath, '$.collections[0]');

    const singleExport = app.exportInitialSetting(character.id);
    assert.equal(singleExport.format, 'ai-dnd-initial-setting-v1');
    assert.equal(singleExport.saved, true);
    assert.equal(singleExport.initialSetting.collections[0].name, 'actors');
    assert.equal(singleExport.initialSetting.collections[0].seedRecords[0].id, 'pc');
    assert.equal(singleExport.locations.characterSchema.table, 'character_data_schemas');

    const emptyCharacter = app.importCharacterCard({
      ...card,
      data: {
        ...card.data,
        name: 'No Initial Setting'
      }
    });
    const savedOnlyBundle = app.exportAllInitialSettings();
    assert.equal(savedOnlyBundle.format, 'ai-dnd-initial-settings-bundle-v1');
    assert.equal(savedOnlyBundle.count, 1);
    assert.equal(savedOnlyBundle.initialSettings[0].character.id, character.id);
    const fullBundle = app.exportAllInitialSettings({ includeEmpty: true });
    assert.equal(fullBundle.count, 2);
    assert.ok(fullBundle.initialSettings.some((setting) => setting.character.id === emptyCharacter.id && setting.saved === false));

    const session = app.createChatSession({
      characterCardId: character.id,
      title: 'Initial State',
      includeGreeting: false
    }).session;
    const loaded = app.getInitialSetting(character.id);
    const collectionLocation = loaded.locations.collections[0].chatTargets[0];
    assert.equal(collectionLocation.table, 'actors');
    assert.ok(collectionLocation.databasePath.endsWith('chat-data.sqlite'));
    assert.ok(collectionLocation.schemaFile.endsWith('actors.schema.json'));
    assert.deepEqual(collectionLocation.seedRecordIds, ['pc']);
    assert.equal(app.getChatDataRecord(session.id, 'actors', 'pc').data.hp, 10);

    app.patchChatDataRecord(session.id, 'actors', 'pc', { hp: 2, status: 'wounded' });
    const merged = app.applyInitialSettingToChat(session.id);
    assert.equal(merged.mode, 'merge');
    assert.equal(merged.locations.collections[0].chatTargets[0].table, 'actors');
    assert.equal(app.getChatDataRecord(session.id, 'actors', 'pc').data.hp, 10);

    app.upsertChatDataRecord(session.id, 'actors', { id: 'npc', hp: 3, status: 'extra' });
    app.applyInitialSettingToChat(session.id, { mode: 'replace' });
    assert.throws(() => app.getChatDataRecord(session.id, 'actors', 'npc'), /Record not found/);

    app.patchChatDataRecord(session.id, 'actors', 'pc', { hp: 4, status: 'scarred' });
    const renamedField = app.updateInitialSettingField(character.id, 'actors', 'hp', {
      name: 'health',
      description: 'Current health.'
    }, {
      syncExisting: true
    });
    assert.equal(renamedField.fieldOperation.type, 'rename');
    assert.equal(renamedField.initialSetting.collections[0].fields[0].name, 'health');
    assert.equal(renamedField.initialSetting.collections[0].seedRecords[0].health, 10);
    assert.equal(renamedField.fieldOperation.syncedChats.length, 1);
    assert.equal(renamedField.fieldOperation.syncedChats[0].fieldChange.renamed, true);
    const renamedRecord = app.getChatDataRecord(session.id, 'actors', 'pc');
    assert.equal(renamedRecord.data.health, 4);
    assert.equal(Object.hasOwn(renamedRecord.data, 'hp'), false);

    const deletedField = app.deleteInitialSettingField(character.id, 'actors', 'status', {
      syncExisting: true
    });
    assert.equal(deletedField.fieldOperation.deleted, true);
    assert.equal(deletedField.initialSetting.collections[0].fields.some((field) => field.name === 'status'), false);
    const deletedFieldRecord = app.getChatDataRecord(session.id, 'actors', 'pc');
    assert.equal(Object.hasOwn(deletedFieldRecord.data, 'status'), false);

    assert.throws(() => app.previewInitialSetting(character.id, {
      collections: [
        {
          name: 'actors',
          fields: [{ name: 'hp', type: 'integer' }],
          seedRecords: [{ id: 'bad', hp: 1, unknown: true }]
        }
      ]
    }), /not registered/);

    const deletedSetting = app.deleteInitialSetting(character.id);
    assert.equal(deletedSetting.deleted, true);
    assert.equal(deletedSetting.chatDataRetained, true);
    assert.equal(deletedSetting.previous.initialSetting.collections[0].name, 'actors');
    assert.throws(() => app.getCharacterDataSchema(character.id), /Character data schema not found/);
    assert.equal(app.getInitialSetting(character.id).initialSetting.collections.length, 0);
    assert.equal(app.exportAllInitialSettings().count, 0);
    assert.equal(app.deleteInitialSetting(character.id).deleted, false);
  } finally {
    app?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('deleting a chat deletes its runtime chat data database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-app-'));
  let app;

  try {
    app = new AppDatabase({
      databasePath: join(directory, 'app.sqlite'),
      chatDataDirectory: join(directory, 'chat-databases')
    });
    const character = app.importCharacterCard(card);
    app.registerCharacterDataSchema(character.id, {
      collections: [
        {
          name: 'actors',
          fields: [{ name: 'hp', type: 'integer' }]
        }
      ]
    });
    const session = app.createChatSession({
      characterCardId: character.id,
      title: 'File Backed State',
      includeGreeting: false
    }).session;
    app.upsertChatDataRecord(session.id, 'actors', { id: 'pc', hp: 7 });

    const databasePath = session.dataDatabase.databasePath;
    assert.equal(existsSync(databasePath), true);

    const deleted = app.deleteChatSession(session.id);
    assert.equal(deleted.deleted, true);
    assert.equal(deleted.dataDatabase.deleted, true);
    assert.equal(existsSync(databasePath), false);
  } finally {
    app?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
