// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import {
  AgentChatRuntime,
  AppDatabase,
  StructuredInterfaceStateStore,
  createApiServer,
  MockChatProvider,
  SQLiteDataManager
} from '../src/index.js';

test('api creates session and accepts a message', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const runtime = new AgentChatRuntime({ chatProvider: new MockChatProvider(), dataManager });
  const server = createApiServer({ runtime });

  const created = await dispatchJson(server, 'POST', '/v1/chat/sessions', {
    characterCard: {
      data: {
        name: 'Mira',
        first_mes: 'Begin.'
      }
    },
    userName: 'Player'
  });

  assert.equal(created.statusCode, 201);
  assert.ok(created.body.session.id);

  const reply = await dispatchJson(server, 'POST', `/v1/chat/sessions/${created.body.session.id}/messages`, {
    content: 'Hello'
  });

  assert.equal(reply.statusCode, 200);
  assert.match(reply.body.message.content, /局面|细节|行动结果/);
  assert.doesNotMatch(reply.body.message.content, /# Current Input|# Raw Input|框架|Prompt/);
  dataManager.close();
});

test('api serves the bundled chat web interface', async () => {
  const runtime = new AgentChatRuntime({ chatProvider: new MockChatProvider() });
  const server = createApiServer({ runtime });

  const index = await dispatchRaw(server, 'GET', '/', undefined);
  assert.equal(index.statusCode, 200);
  assert.match(index.headers['content-type'], /text\/html/);
  assert.match(index.body, /data-testid="app-shell"/);

  const script = await dispatchRaw(server, 'GET', '/app/app.js', undefined);
  assert.equal(script.statusCode, 200);
  assert.match(script.headers['content-type'], /text\/javascript/);
  assert.match(script.body, /sendAppChatMessage|system.context_planner.plan_context/);

  const toolManager = await dispatchRaw(server, 'GET', '/tool-manager/', undefined);
  assert.equal(toolManager.statusCode, 200);
  assert.match(toolManager.headers['content-type'], /text\/html/);
  assert.match(toolManager.body, /AI DND Tool Manager/);

  const toolManagerScript = await dispatchRaw(server, 'GET', '/tool-manager/tool-manager.js', undefined);
  assert.equal(toolManagerScript.statusCode, 200);
  assert.match(toolManagerScript.headers['content-type'], /text\/javascript/);
  assert.match(toolManagerScript.body, /BUILTIN_DEPENDENCIES|executeSelectedTool/);
});

test('api tests frontend chat api settings', async () => {
  const runtime = new AgentChatRuntime({ chatProvider: new MockChatProvider() });
  const server = createApiServer({ runtime });

  const serverResult = await dispatchJson(server, 'POST', '/v1/chat/api-test', {
    api: { provider: 'server' }
  });
  assert.equal(serverResult.statusCode, 200);
  assert.equal(serverResult.body.ok, true);
  assert.equal(serverResult.body.provider, 'server');

  const mockResult = await dispatchJson(server, 'POST', '/v1/chat/api-test', {
    api: { provider: 'mock' }
  });
  assert.equal(mockResult.statusCode, 200);
  assert.equal(mockResult.body.ok, true);
  assert.equal(mockResult.body.provider, 'mock');
});

test('api supports tool plugin CRUD and core tool execution', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const runtime = new AgentChatRuntime({ chatProvider: new MockChatProvider(), dataManager });
  const server = createApiServer({ runtime });

  const created = await dispatchJson(server, 'POST', '/v1/tool-plugins', {
    id: 'api.tools',
    name: 'API Tools',
    tools: [
      {
        name: 'lookup',
        description: 'Lookup placeholder.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' }
          },
          required: ['query'],
          additionalProperties: false
        }
      }
    ]
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.plugin.id, 'api.tools');

  const listed = await dispatchJson(server, 'GET', '/v1/tools', undefined);
  assert.equal(listed.statusCode, 200);
  assert.ok(listed.body.tools.some((tool) => tool.id === 'api.tools.lookup'));

  const claudeTools = await dispatchJson(server, 'GET', '/v1/tools?format=claude', undefined);
  assert.equal(claudeTools.statusCode, 200);
  assert.ok(claudeTools.body.tools.some((tool) => tool.name === 'api_tools_lookup' && tool.input_schema));

  const updated = await dispatchJson(server, 'PATCH', '/v1/tool-plugins/api.tools/tools/lookup', {
    description: 'Updated lookup placeholder.'
  });
  assert.equal(updated.body.tool.description, 'Updated lookup placeholder.');

  const imported = await dispatchJson(server, 'POST', '/v1/tools/import', {
    kind: 'ai-dnd-tool-bundle',
    plugins: [
      {
        id: 'api.imported',
        name: 'Imported API Tools',
        permissions: ['database:read'],
        metadata: {
          reuses: ['system.data']
        },
        tools: [
          {
            name: 'alpha',
            description: 'Imported alpha tool.',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', minLength: 1 }
              },
              required: ['query'],
              additionalProperties: false
            }
          },
          {
            name: 'beta',
            description: 'Imported beta tool.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false
            }
          }
        ]
      }
    ]
  });
  assert.equal(imported.statusCode, 200);
  assert.deepEqual(imported.body.createdPlugins, ['api.imported']);
  assert.ok(imported.body.createdTools.includes('api.imported.alpha'));
  assert.ok(imported.body.createdTools.includes('api.imported.beta'));

  const reimported = await dispatchJson(server, 'POST', '/v1/tools/import', {
    plugins: [
      {
        id: 'api.imported',
        name: 'Imported API Tools',
        tools: [
          {
            name: 'alpha',
            description: 'Updated imported alpha tool.',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', minLength: 1 }
              },
              required: ['query'],
              additionalProperties: false
            }
          }
        ]
      }
    ]
  });
  assert.equal(reimported.statusCode, 200);
  assert.ok(reimported.body.updatedTools.includes('api.imported.alpha'));
  assert.equal(runtime.getTool('api.imported.alpha').description, 'Updated imported alpha tool.');

  const batchDeleted = await dispatchJson(server, 'POST', '/v1/tools/delete', {
    toolIds: ['api.imported.alpha', 'api.imported.beta']
  });
  assert.equal(batchDeleted.statusCode, 200);
  assert.deepEqual(batchDeleted.body.deletedTools.sort(), ['api.imported.alpha', 'api.imported.beta']);
  assert.equal(runtime.getToolPlugin('api.imported').tools.length, 0);

  const echo = await dispatchJson(server, 'POST', '/v1/tools/core.utility.echo/execute', {
    input: {
      text: 'hello'
    }
  });
  assert.deepEqual(echo.body.result.output, { text: 'hello' });

  const deleted = await dispatchJson(server, 'DELETE', '/v1/tool-plugins/api.tools', undefined);
  assert.equal(deleted.body.plugin.id, 'api.tools');
  dataManager.close();
});

test('api reads workspace debug trace files', async () => {
  mkdirSync(join(process.cwd(), 'data'), { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), 'data/api-debug-traces-'));
  const previousTraceDirectory = process.env.AI_DND_TOOL_TRACE_DIR;
  process.env.AI_DND_TOOL_TRACE_DIR = directory;
  const runtime = new AgentChatRuntime({
    chatProvider: new MockChatProvider(),
    toolTrace: {
      directory
    }
  });
  const server = createApiServer({ runtime });

  try {
    const echo = await dispatchJson(server, 'POST', '/v1/tools/core.utility.echo/execute', {
      input: {
        text: 'debug file read'
      }
    });
    const inputPath = echo.body.result.trace.files.input;
    const debug = await dispatchJson(server, 'POST', '/v1/debug/files/read', {
      path: inputPath
    });
    assert.equal(debug.statusCode, 200);
    assert.equal(debug.body.file.path, inputPath);
    assert.match(debug.body.file.content, /debug file read/);

    const latest = await dispatchJson(
      server,
      'GET',
      `/v1/debug/traces/latest?toolId=${encodeURIComponent('core.utility.echo')}`,
      undefined
    );
    assert.equal(latest.statusCode, 200);
    assert.equal(latest.body.trace.files.input, inputPath);
  } finally {
    if (previousTraceDirectory === undefined) {
      delete process.env.AI_DND_TOOL_TRACE_DIR;
    } else {
      process.env.AI_DND_TOOL_TRACE_DIR = previousTraceDirectory;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('api executes data manager tools', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const runtime = new AgentChatRuntime({ chatProvider: new MockChatProvider(), dataManager });
  const server = createApiServer({ runtime });

  const upserted = await dispatchJson(server, 'POST', '/v1/tools/system.data.semantic_update/execute', {
    input: {
      collection: 'npcs',
      id: 'npc-1',
      text: 'Mira is a level 3 harbor NPC.',
      values: {
        name: 'Mira',
        level: 3,
        faction: 'harbor'
      }
    }
  });
  assert.equal(upserted.statusCode, 200);
  assert.equal(upserted.body.result.output.data.name, 'Mira');

  const queried = await dispatchJson(server, 'POST', '/v1/tools/system.data.query_fields/execute', {
    input: {
      collection: 'npcs',
      fields: ['name', 'level'],
      filter: {
        level: { $gte: 2 }
      }
    }
  });
  assert.equal(queried.body.result.output.records.length, 1);
  assert.equal(queried.body.result.output.records[0].id, 'npc-1');
  assert.equal(queried.body.result.output.records[0].fields.name, 'Mira');

  dataManager.close();
});

test('api manages app character cards and chats', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
  const runtime = new AgentChatRuntime({ chatProvider: new MockChatProvider(), dataManager, appDatabase });
  const server = createApiServer({ runtime, appDatabase });

  const imported = await dispatchJson(server, 'POST', '/v1/app/characters/import', {
    characterCard: {
      data: {
        name: 'Mira',
        first_mes: 'Begin.'
      }
    }
  });
  assert.equal(imported.statusCode, 201);
  assert.equal(imported.body.character.name, 'Mira');

  const fetchedCharacter = await dispatchJson(server, 'GET', `/v1/app/characters/${imported.body.character.id}`, undefined);
  assert.equal(fetchedCharacter.statusCode, 200);
  assert.equal(fetchedCharacter.body.character.name, 'Mira');

  const updatedCharacter = await dispatchJson(server, 'PUT', `/v1/app/characters/${imported.body.character.id}`, {
    characterCard: {
      data: {
        name: 'Mira Updated',
        first_mes: 'Updated begin.'
      }
    },
    notes: 'api update'
  });
  assert.equal(updatedCharacter.statusCode, 200);
  assert.equal(updatedCharacter.body.character.name, 'Mira Updated');
  assert.equal(updatedCharacter.body.character.revisions.length, 2);

  const patchedCharacter = await dispatchJson(server, 'PATCH', `/v1/app/characters/${imported.body.character.id}`, {
    description: 'Patched description.'
  });
  assert.equal(patchedCharacter.statusCode, 200);
  assert.equal(patchedCharacter.body.character.currentRevision.data.description, 'Patched description.');

  const chat = await dispatchJson(server, 'POST', '/v1/app/chats', {
    characterCardId: imported.body.character.id,
    title: 'API Chat',
    userName: 'Player'
  });
  assert.equal(chat.statusCode, 201);
  assert.equal(chat.body.session.characterCard.data.name, 'Mira Updated');
  assert.equal(chat.body.session.messages.length, 0);
  assert.equal(chat.body.greeting.status, 'skipped');
  assert.equal(chat.body.greeting.reason, 'missing_bound_protagonist');

  const renamedChat = await dispatchJson(server, 'POST', `/v1/app/chats/${chat.body.session.id}/update`, {
    title: 'API Chat Renamed'
  });
  assert.equal(renamedChat.statusCode, 200);
  assert.equal(renamedChat.body.chat.title, 'API Chat Renamed');

  const switchedCharacter = await dispatchJson(server, 'POST', `/v1/app/characters/${imported.body.character.id}/switch`, {});
  assert.equal(switchedCharacter.statusCode, 200);
  assert.equal(switchedCharacter.body.active.characterCardId, imported.body.character.id);
  assert.equal(switchedCharacter.body.session.id, chat.body.session.id);

  const message = await dispatchJson(server, 'POST', `/v1/app/chats/${chat.body.session.id}/messages`, {
    role: 'user',
    name: 'Player',
    content: 'Hello'
  });
  assert.equal(message.statusCode, 201);
  assert.equal(message.body.message.content, 'Hello');

  const editedMessage = await dispatchJson(server, 'PATCH', `/v1/app/chats/${chat.body.session.id}/messages/${message.body.message.id}`, {
    content: 'Hello, edited.',
    reason: 'api test'
  });
  assert.equal(editedMessage.statusCode, 200);
  assert.equal(editedMessage.body.message.content, 'Hello, edited.');
  assert.equal(editedMessage.body.message.metadata.editedBy, 'user');

  const postedEditMessage = await dispatchJson(server, 'POST', `/v1/app/chats/${chat.body.session.id}/messages/${message.body.message.id}/update`, {
    content: 'Hello, edited through UI route.',
    reason: 'api test'
  });
  assert.equal(postedEditMessage.statusCode, 200);
  assert.equal(postedEditMessage.body.message.content, 'Hello, edited through UI route.');

  const sent = await dispatchJson(server, 'POST', `/v1/app/chats/${chat.body.session.id}/send`, {
    content: '继续推进场景。'
  });
  assert.equal(sent.statusCode, 200);
  assert.match(sent.body.assistantMessage.content, /局面|细节|行动结果/);
  assert.doesNotMatch(sent.body.assistantMessage.content, /# Current Input|# Raw Input|框架|Prompt/);
  assert.equal(sent.body.agentLoop.dryRun, false);
  assert.ok(sent.body.agentLoop.finalOutput.phases.some((phase) => phase.phaseId === 'narrative.render'));
  assert.equal(sent.body.chat.messages.length, 3);
  const progressEvents = await dispatchJson(server, 'GET', `/v1/agent-progress/events?chatSessionId=${encodeURIComponent(chat.body.session.id)}`, undefined);
  assert.equal(progressEvents.statusCode, 200);
  assert.ok(progressEvents.body.events.some((event) => event.type === 'savepoint_started'));
  assert.ok(progressEvents.body.events.some((event) => event.type === 'phase_started' && event.phaseId === 'narrative.render'));
  assert.ok(progressEvents.body.events.some((event) => event.type === 'assistant_message_committed'));

  const dataSchema = await dispatchJson(server, 'POST', `/v1/app/characters/${imported.body.character.id}/data-schema`, {
    schema: {
      collections: [
        {
          name: 'actors',
          fields: [
            { name: 'hp', type: 'integer', required: true },
            { name: 'status', type: 'text' }
          ]
        }
      ]
    }
  });
  assert.equal(dataSchema.statusCode, 200);
  assert.equal(dataSchema.body.dataSchema.schema.collections[0].name, 'actors');

  const initialPreview = await dispatchJson(server, 'POST', `/v1/app/characters/${imported.body.character.id}/initial-setting/preview`, {
    schema: {
      description: 'API editable initial state.',
      collections: [
        {
          name: 'actors',
          fields: [
            { name: 'hp', type: 'integer', required: true },
            { name: 'status', type: 'text', defaultValue: 'ready' }
          ],
          seedRecords: [
            { id: 'pc', hp: '12' }
          ]
        }
      ]
    }
  });
  assert.equal(initialPreview.statusCode, 200);
  assert.equal(initialPreview.body.stats.seedRecordCount, 1);
  assert.equal(initialPreview.body.initialSetting.collections[0].seedRecords[0].hp, 12);
  assert.equal(initialPreview.body.locations.characterSchema.table, 'character_data_schemas');
  assert.equal(initialPreview.body.locations.collections[0].name, 'actors');

  const initialSaved = await dispatchJson(server, 'PUT', `/v1/app/characters/${imported.body.character.id}/initial-setting`, {
    schema: initialPreview.body.initialSetting
  });
  assert.equal(initialSaved.statusCode, 200);
  assert.equal(initialSaved.body.saved, true);
  assert.equal(initialSaved.body.locations.characterSchema.column, 'schema_json');

  const initialExport = await dispatchJson(server, 'GET', `/v1/app/characters/${imported.body.character.id}/initial-setting/export`, undefined);
  assert.equal(initialExport.statusCode, 200);
  assert.equal(initialExport.body.format, 'ai-dnd-initial-setting-v1');
  assert.equal(initialExport.body.initialSetting.collections[0].seedRecords[0].id, 'pc');

  dataManager.upsertRecord('character_notes', {
    id: 'char-note',
    summary: 'Character scoped database note.',
    lifecycleScope: 'character',
    characterCardId: imported.body.character.id,
    lifecycleManaged: true
  });
  dataManager.upsertRecord('chat_notes', {
    id: 'chat-note',
    summary: 'Chat scoped database note.',
    lifecycleScope: 'chat',
    characterCardId: imported.body.character.id,
    chatSessionId: chat.body.session.id,
    lifecycleManaged: true
  });
  await runtime.ragService.ingestText({
    collection: 'api-runtime',
    sourceId: 'char-rag',
    text: 'Character scoped RAG note.',
    metadata: {
      lifecycleScope: 'character',
      characterCardId: imported.body.character.id,
      lifecycleManaged: true
    }
  });
  await runtime.ragService.ingestText({
    collection: 'api-runtime',
    sourceId: 'chat-rag',
    text: 'Chat scoped RAG note.',
    metadata: {
      lifecycleScope: 'chat',
      characterCardId: imported.body.character.id,
      chatSessionId: chat.body.session.id,
      lifecycleManaged: true
    }
  });

  const exportedCharacter = await dispatchJson(server, 'GET', `/v1/app/characters/${imported.body.character.id}/export`, undefined);
  assert.equal(exportedCharacter.statusCode, 200);
  assert.equal(exportedCharacter.body.data.name, 'Mira Updated');
  assert.equal(Object.hasOwn(exportedCharacter.body, 'resources'), false);

  const exportedCharacterResources = await dispatchJson(server, 'GET', `/v1/app/characters/${imported.body.character.id}/export/resources`, undefined);
  assert.equal(exportedCharacterResources.statusCode, 200);
  assert.equal(exportedCharacterResources.body.format, 'ai-dnd-character-resources-v1');
  assert.equal(exportedCharacterResources.body.resources.globalData.collections[0].collection, 'character_notes');
  assert.equal(exportedCharacterResources.body.resources.runtimeRag.collections[0].collection, 'api-runtime');
  assert.equal(exportedCharacterResources.body.resources.runtimeRag.collections[0].documents[0].metadata.lifecycleScope, 'character');

  const looseCharacterImport = await dispatchJson(server, 'POST', '/v1/app/characters/import', {
    characterCard: {
      data: {
        name: 'Loose Resources',
        first_mes: 'Loose begin.'
      }
    },
    sidecar: {
      format: 'ai-dnd-character-resources-v1',
      resources: {
        globalData: {
          collections: [
            {
              collection: 'loose_notes',
              records: [
                { id: 'loose-note', summary: 'Unscoped character sidecar note.' }
              ]
            }
          ]
        },
        runtimeRag: {
          collections: [
            {
              collection: 'api-runtime',
              documents: [
                { id: 'loose-rag', text: 'Unscoped character sidecar RAG note.', metadata: {} }
              ]
            }
          ]
        }
      }
    }
  });
  assert.equal(looseCharacterImport.statusCode, 201);
  const looseNote = dataManager.queryRecords('loose_notes', { lifecycleFilter: false, limit: 10 })
    .records.find((record) => record.id === 'loose-note');
  assert.equal(looseNote.data.lifecycleScope, 'character');
  assert.equal(looseNote.data.characterCardId, looseCharacterImport.body.character.id);
  assert.equal(looseNote.data.chatSessionId, '');
  const looseRag = runtime.ragService.listDocuments({ collection: 'api-runtime', limit: 20 })
    .documents.find((document) => document.id === 'loose-rag');
  assert.equal(looseRag.metadata.lifecycleScope, 'character');
  assert.equal(looseRag.metadata.characterCardId, looseCharacterImport.body.character.id);
  assert.equal(looseRag.metadata.chatSessionId, undefined);

  const allInitialExports = await dispatchJson(server, 'GET', '/v1/app/initial-settings/export', undefined);
  assert.equal(allInitialExports.statusCode, 200);
  assert.equal(allInitialExports.body.format, 'ai-dnd-initial-settings-bundle-v1');
  assert.equal(allInitialExports.body.count, 1);
  assert.equal(allInitialExports.body.initialSettings[0].character.id, imported.body.character.id);

  const initialApplied = await dispatchJson(server, 'POST', `/v1/app/chats/${chat.body.session.id}/initial-setting/apply`, {});
  assert.equal(initialApplied.statusCode, 200);
  assert.equal(initialApplied.body.stats.seedRecordCount, 1);
  assert.equal(initialApplied.body.locations.collections[0].chatTargets[0].table, 'actors');

  const initialRecord = await dispatchJson(server, 'GET', `/v1/app/chats/${chat.body.session.id}/data-db/collections/actors/records/pc`, undefined);
  assert.equal(initialRecord.statusCode, 200);
  assert.equal(initialRecord.body.record.data.hp, 12);

  const stateRecord = await dispatchJson(server, 'POST', `/v1/app/chats/${chat.body.session.id}/data-db/collections/actors/records`, {
    id: 'pc',
    hp: '8',
    status: 'ready'
  });
  assert.equal(stateRecord.statusCode, 201);
  assert.equal(stateRecord.body.record.data.hp, 8);

  const stateQuery = await dispatchJson(server, 'POST', `/v1/app/chats/${chat.body.session.id}/data-db/collections/actors/query`, {
    filter: {
      hp: { $gte: 5 }
    }
  });
  assert.equal(stateQuery.statusCode, 200);
  assert.equal(stateQuery.body.records[0].id, 'pc');

  const renamedField = await dispatchJson(
    server,
    'PATCH',
    `/v1/app/characters/${imported.body.character.id}/initial-setting/collections/actors/fields/hp?syncExisting=true`,
    {
      name: 'health',
      description: 'Current health.'
    }
  );
  assert.equal(renamedField.statusCode, 200);
  assert.equal(renamedField.body.fieldOperation.type, 'rename');
  assert.equal(renamedField.body.initialSetting.collections[0].fields[0].name, 'health');
  assert.equal(renamedField.body.fieldOperation.syncedChats[0].fieldChange.renamed, true);

  const renamedRecord = await dispatchJson(server, 'GET', `/v1/app/chats/${chat.body.session.id}/data-db/collections/actors/records/pc`, undefined);
  assert.equal(renamedRecord.statusCode, 200);
  assert.equal(renamedRecord.body.record.data.health, 8);
  assert.equal(Object.hasOwn(renamedRecord.body.record.data, 'hp'), false);

  const deletedField = await dispatchJson(
    server,
    'DELETE',
    `/v1/app/characters/${imported.body.character.id}/initial-setting/collections/actors/fields/status?syncExisting=true`,
    undefined
  );
  assert.equal(deletedField.statusCode, 200);
  assert.equal(deletedField.body.fieldOperation.deleted, true);
  assert.equal(deletedField.body.initialSetting.collections[0].fields.some((field) => field.name === 'status'), false);

  const deletedFieldRecord = await dispatchJson(server, 'GET', `/v1/app/chats/${chat.body.session.id}/data-db/collections/actors/records/pc`, undefined);
  assert.equal(deletedFieldRecord.statusCode, 200);
  assert.equal(Object.hasOwn(deletedFieldRecord.body.record.data, 'status'), false);

  const exported = await dispatchJson(server, 'GET', `/v1/app/chats/${chat.body.session.id}/export`, undefined);
  assert.equal(exported.body.format, 'ai-dnd-chat-v1');
  assert.equal(exported.body.messages.length, 3);
  assert.ok(exported.body.dataDatabase.collections.some((collection) => collection.collection === 'actors'));
  assert.equal(Object.hasOwn(exported.body, 'resources'), false);

  const exportedResources = await dispatchJson(server, 'GET', `/v1/app/chats/${chat.body.session.id}/export/resources`, undefined);
  assert.equal(exportedResources.body.format, 'ai-dnd-chat-resources-v1');
  assert.equal(exportedResources.body.resources.globalData.collections[0].collection, 'chat_notes');
  assert.equal(exportedResources.body.resources.runtimeRag.collections[0].documents[0].metadata.lifecycleScope, 'chat');

  const importedChat = await dispatchJson(server, 'POST', '/v1/app/chats/import', {
    ...exported.body,
    sidecar: exportedResources.body
  });
  assert.equal(importedChat.statusCode, 201);
  assert.equal(importedChat.body.chat.title, 'API Chat Renamed');
  assert.equal(importedChat.body.chat.messages.length, 3);
  assert.equal(importedChat.body.resources.globalData.importedCollections[0].collection, 'chat_notes');
  const importedRagDocs = runtime.ragService.listDocuments({
    collection: 'api-runtime',
    filter: { chatSessionId: importedChat.body.chat.id },
    limit: 20
  }).documents;
  assert.ok(importedRagDocs.some((document) => document.text === 'Chat scoped RAG note.'));
  const deletedImportedChat = await dispatchJson(server, 'DELETE', `/v1/app/chats/${importedChat.body.chat.id}`, undefined);
  assert.equal(deletedImportedChat.statusCode, 200);
  assert.equal(deletedImportedChat.body.deleted, true);
  assert.equal(dataManager.queryRecords('chat_notes', { lifecycleFilter: false, limit: 20 }).records
    .some((record) => record.data.chatSessionId === importedChat.body.chat.id), false);
  assert.equal(runtime.ragService.listDocuments({
    collection: 'api-runtime',
    filter: { chatSessionId: importedChat.body.chat.id },
    limit: 20
  }).documents.length, 0);

  const deletedMessage = await dispatchJson(server, 'DELETE', `/v1/app/chats/${chat.body.session.id}/messages/${message.body.message.id}`, {
    reason: 'api test'
  });
  assert.equal(deletedMessage.statusCode, 200);
  assert.equal(deletedMessage.body.deleted, true);

  const deletedInitial = await dispatchJson(server, 'DELETE', `/v1/app/characters/${imported.body.character.id}/initial-setting`, undefined);
  assert.equal(deletedInitial.statusCode, 200);
  assert.equal(deletedInitial.body.deleted, true);
  assert.equal(deletedInitial.body.chatDataRetained, true);
  assert.equal(deletedInitial.body.previous.initialSetting.collections[0].name, 'actors');

  const emptyInitial = await dispatchJson(server, 'GET', `/v1/app/characters/${imported.body.character.id}/initial-setting`, undefined);
  assert.equal(emptyInitial.statusCode, 200);
  assert.equal(emptyInitial.body.initialSetting.collections.length, 0);

  const allAfterDelete = await dispatchJson(server, 'GET', '/v1/app/initial-settings/export', undefined);
  assert.equal(allAfterDelete.statusCode, 200);
  assert.equal(allAfterDelete.body.count, 0);

  const deleted = await dispatchJson(server, 'DELETE', `/v1/app/chats/${chat.body.session.id}`, undefined);
  assert.equal(deleted.body.deleted, true);
  assert.equal(deleted.body.dataDatabase.deleted, true);
  assert.equal(deleted.body.resourceCleanup.worldline.savepoints, 1);
  const deletedChatSavepoints = await dispatchJson(server, 'GET', `/v1/worldlines/savepoints?scopeType=app-chat&scopeId=${chat.body.session.id}&limit=20`, undefined);
  assert.equal(deletedChatSavepoints.body.savepoints.length, 0);
  assert.equal(dataManager.queryRecords('chat_notes', { lifecycleFilter: false, limit: 20 }).records
    .some((record) => record.data.chatSessionId === chat.body.session.id), false);
  assert.equal(runtime.ragService.listDocuments({
    collection: 'api-runtime',
    filter: { chatSessionId: chat.body.session.id },
    limit: 20
  }).documents.length, 0);

  const archived = await dispatchJson(server, 'POST', `/v1/app/characters/${imported.body.character.id}/archive`, {});
  assert.equal(archived.body.archived, true);

  const restored = await dispatchJson(server, 'POST', `/v1/app/characters/${imported.body.character.id}/restore`, {});
  assert.equal(restored.body.restored, true);

  const deletedCharacter = await dispatchJson(server, 'DELETE', `/v1/app/characters/${imported.body.character.id}`, undefined);
  assert.equal(deletedCharacter.body.deleted, true);
  assert.equal(deletedCharacter.body.character.id, imported.body.character.id);

  dataManager.close();
  appDatabase.close();
});

test('api imports app character resources from project JSON file paths', async () => {
  const importRoot = join(process.cwd(), 'tmp');
  mkdirSync(importRoot, { recursive: true });
  const directory = mkdtempSync(join(importRoot, 'api-import-'));
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
  const runtime = new AgentChatRuntime({ chatProvider: new MockChatProvider(), dataManager, appDatabase });
  const server = createApiServer({ runtime, appDatabase });

  try {
    const cardPath = join(directory, 'character.json');
    const sidecarPath = join(directory, 'resources.json');
    writeFileSync(cardPath, JSON.stringify({
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: 'File Path Character',
        first_mes: 'Begin from file.'
      }
    }));
    writeFileSync(sidecarPath, JSON.stringify({
      format: 'ai-dnd-character-resources-v1',
      initialSetting: {
        version: '1',
        collections: [
          {
            name: 'actors',
            fields: [{ name: 'hp', type: 'integer', required: true }],
            seedRecords: [{ id: 'pc', hp: 9 }]
          }
        ]
      },
      resources: {
        globalData: {
          collections: [
            {
              collection: 'file_path_notes',
              records: [{ id: 'note-1', summary: 'Imported from a file path.' }]
            }
          ]
        }
      }
    }));

    const imported = await dispatchJson(server, 'POST', '/v1/app/characters/import', {
      characterCardPath: cardPath,
      sidecarPath
    });
    assert.equal(imported.statusCode, 201);
    assert.equal(imported.body.character.name, 'File Path Character');

    const initial = appDatabase.getInitialSetting(imported.body.character.id);
    assert.equal(initial.initialSetting.collections[0].name, 'actors');
    assert.equal(initial.initialSetting.collections[0].seedRecords[0].hp, 9);

    const note = dataManager.getRecord('file_path_notes', 'note-1');
    assert.equal(note.data.lifecycleScope, 'character');
    assert.equal(note.data.characterCardId, imported.body.character.id);
    assert.equal(note.data.chatSessionId, '');
  } finally {
    dataManager.close();
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('api manages structured interface state for runtime chat sessions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-api-structured-'));
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const runtime = new AgentChatRuntime({
    chatProvider: new MockChatProvider(),
    dataManager,
    structuredInterfaceStore: new StructuredInterfaceStateStore({
      directory: join(directory, 'state'),
      trace: {
        directory: join(directory, 'traces')
      }
    })
  });
  const server = createApiServer({ runtime });

  try {
    const created = await dispatchJson(server, 'POST', '/v1/chat/sessions', {
      characterCard: {
        data: {
          name: 'Mira'
        }
      },
      structuredInterface: {
        enabled: true,
        initialState: {
          sceneMap: {
            title: '营地'
          }
        }
      }
    });
    const sessionId = created.body.session.id;

    const patched = await dispatchJson(server, 'PATCH', `/v1/chat/sessions/${sessionId}/structured-interface`, {
      update: {
        inventory: {
          items: [{ id: 'rope', name: '绳索', quantity: 1 }]
        }
      },
      source: 'manual'
    });
    assert.equal(patched.statusCode, 200);
    assert.equal(patched.body.state.inventory.items[0].name, '绳索');

    const prompt = await dispatchJson(server, 'GET', `/v1/chat/sessions/${sessionId}/structured-interface/prompt`, undefined);
    assert.equal(prompt.statusCode, 200);
    assert.match(prompt.body.prompt, /AI_DND_STRUCTURED_STATE/);
    assert.equal(prompt.body.trace.operation, 'build-prompt');

    const applied = await dispatchJson(server, 'POST', `/v1/chat/sessions/${sessionId}/structured-interface/apply-output`, {
      content: '更新完成。<AI_DND_STRUCTURED_STATE>{"sceneMap":{"title":"钟楼"}}</AI_DND_STRUCTURED_STATE>'
    });
    assert.equal(applied.body.content, '更新完成。');
    assert.equal(applied.body.state.sceneMap.title, '钟楼');
    assert.equal(applied.body.trace.operation, 'apply-model-output');

    const current = await dispatchJson(server, 'GET', `/v1/chat/sessions/${sessionId}/structured-interface`, undefined);
    assert.equal(current.body.state.sceneMap.title, '钟楼');
    assert.equal(current.body.state.inventory.items[0].id, 'rope');
  } finally {
    dataManager.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('api runs a debug tool sequence for direct bug reproduction', async () => {
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
  const runtime = new AgentChatRuntime({
    chatProvider: new MockChatProvider(),
    appDatabase
  });
  const server = createApiServer({ runtime, appDatabase });
  const character = appDatabase.importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Debug GM',
      first_mes: 'Begin.'
    }
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Debug Tool Sequence',
    includeGreeting: false
  }).session;

  try {
    const sequence = await dispatchJson(server, 'POST', '/v1/debug/tool-sequence', {
      context: {
        authorization: true,
        source: 'api-test.debug-sequence'
      },
      steps: [
        {
          toolId: 'system.npc_state.patch_state',
          input: {
            chatSessionId: chat.id,
            sceneId: 'camp',
            npcId: 'pc_debug',
            actorType: 'player',
            isPlayer: true,
            name: 'Debug PC',
            inventory: {
              items: [{ id: 'plain_stone', name: 'Plain Stone', quantity: 1 }]
            }
          }
        },
        {
          toolId: 'system.slot_use.commit_use',
          input: {
            chatSessionId: chat.id,
            sceneId: 'camp',
            actorId: 'pc_debug',
            sourceKind: 'item',
            itemId: 'plain_stone'
          }
        }
      ]
    });

    assert.equal(sequence.statusCode, 200);
    assert.equal(sequence.body.ok, true);
    assert.equal(sequence.body.results.length, 2);
    assert.equal(sequence.body.results[0].toolId, 'system.npc_state.patch_state');
    assert.equal(sequence.body.results[1].result.output.ok, false);
    assert.equal(sequence.body.results[1].result.output.reason, 'item_has_no_direct_effect');
  } finally {
    appDatabase.close();
  }
});

async function dispatchJson(server, method, url, body) {
  const response = await dispatchRaw(server, method, url, body);
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: JSON.parse(response.body || '{}')
  };
}

async function dispatchRaw(server, method, url, body) {
  const request = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  request.method = method;
  request.url = url;

  const response = new MockResponse();
  const finished = once(response, 'finish');
  server.emit('request', request, response);
  await finished;

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.body || ''
  };
}

class MockResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.chunks = [];
  }

  writeHead(statusCode, headers) {
    this.statusCode = statusCode;
    this.headers = headers;
    return this;
  }

  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  end(chunk) {
    if (chunk) {
      this.chunks.push(Buffer.from(chunk));
    }
    this.body = Buffer.concat(this.chunks).toString('utf8');
    this.emit('finish');
    return this;
  }
}
