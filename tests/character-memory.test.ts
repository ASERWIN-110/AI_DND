// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppDatabase,
  CHARACTER_MEMORY_PLUGIN,
  CharacterMemoryStore,
  ChatCompressionMemory,
  SceneNpcMountManager,
  ToolPluginManager,
  createCharacterMemoryHandlers,
  createDefaultToolPluginManager,
  extractCharacterMemoryUpdates,
  stripCharacterMemoryUpdates
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
    title: 'Character Memory Test',
    includeGreeting: false
  }).session;
  const messages = [
    appDatabase.addChatMessage(chat.id, {
      role: 'user',
      name: 'Player',
      content: '我答应米拉去旧市场找银钥匙。'
    }),
    appDatabase.addChatMessage(chat.id, {
      role: 'assistant',
      name: 'Test GM',
      content: '米拉提醒你不要把计划告诉男爵。'
    })
  ];
  return { appDatabase, chat, messages };
}

function seedCompression(appDatabase, chat, messages) {
  const compression = new ChatCompressionMemory({ appDatabase, trace: false });
  compression.applyModelOutput(chat.id, [
    '<AI_DND_CHAT_COMPRESSION>',
    JSON.stringify({
      summaries: [
        {
          type: 'segment_summary',
          title: '米拉的银钥匙任务',
          summary: '玩家答应米拉去旧市场寻找银钥匙，并对男爵保密。',
          npcNotes: [
            { npcId: 'npc_mira', name: '米拉', summary: '米拉信任玩家能保守秘密。' }
          ],
          sourceMessageIds: messages.map((message) => message.id),
          fromOrderIndex: messages[0].orderIndex,
          toOrderIndex: messages[1].orderIndex,
          importance: 0.8
        },
        {
          type: 'pinned_fact',
          title: '男爵保密',
          summary: '玩家答应不把米拉的计划告诉男爵。',
          importance: 0.95
        }
      ]
    }),
    '</AI_DND_CHAT_COMPRESSION>'
  ].join('\n'));
  return compression;
}

test('character memory projects compressed chat memory into scene NPC prompt context', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-character-memory-'));
  const { appDatabase, chat, messages } = createTestChat();
  const chatCompression = seedCompression(appDatabase, chat, messages);
  const sceneNpcs = new SceneNpcMountManager({ appDatabase });
  sceneNpcs.mountNpc({
    chatSessionId: chat.id,
    sceneId: 'current',
    npcId: 'npc_mira',
    name: '米拉',
    role: '委托人',
    status: 'present'
  });
  const store = new CharacterMemoryStore({
    appDatabase,
    chatCompression,
    trace: {
      directory: join(directory, 'traces')
    }
  });

  try {
    const prompt = store.buildPrompt(chat.id, {
      sceneId: 'current',
      compressionLimit: 5
    });
    assert.match(prompt.prompt, /AI_DND_CHARACTER_MEMORY/);
    assert.match(prompt.prompt, /Compressed source records/);
    assert.equal(prompt.characters[0].characterId, 'npc_mira');
    assert.equal(prompt.compressionRecords.length, 2);
    assert.equal(existsSync(prompt.trace.files.prompt), true);

    const sourceIds = prompt.compressionRecords.map((record) => record.id);
    const content = [
      '角色记忆已整理。',
      '<AI_DND_CHARACTER_MEMORY>',
      JSON.stringify({
        memories: [
          {
            characterId: 'npc_mira',
            name: '米拉',
            memoryType: 'promise',
            summary: '玩家答应帮米拉去旧市场找银钥匙，并承诺不把计划告诉男爵。',
            knowledgeState: 'known',
            importance: 0.9,
            emotionalWeight: 0.7,
            confidence: 0.95,
            visibility: 'private',
            tags: ['silver_key', 'baron'],
            sourceCompressionIds: sourceIds,
            sourceMessageIds: messages.map((message) => message.id),
            fromOrderIndex: messages[0].orderIndex,
            toOrderIndex: messages[1].orderIndex
          }
        ]
      }),
      '</AI_DND_CHARACTER_MEMORY>'
    ].join('\n');

    const extracted = extractCharacterMemoryUpdates(content);
    assert.equal(extracted.updates.length, 1);
    assert.equal(stripCharacterMemoryUpdates(content), '角色记忆已整理。');

    const applied = store.applyModelOutput(chat.id, content);
    assert.equal(applied.content, '角色记忆已整理。');
    assert.equal(applied.updated, true);
    assert.equal(applied.records[0].data.characterId, 'npc_mira');
    assert.equal(applied.records[0].data.memoryType, 'promise');
    assert.equal(applied.records[0].data.sourceCompressionIds.length, 2);
    assert.equal(existsSync(applied.trace.files.stateAfter), true);

    const context = store.getPromptContext(chat.id, {
      sceneId: 'current',
      limitPerCharacter: 5
    });
    assert.match(context.context, /npc_mira/);
    assert.match(context.context, /银钥匙/);
    assert.equal(context.characters[0].characterId, 'npc_mira');
    assert.ok(context.tokenEstimate > 0);
    assert.match(readFileSync(prompt.trace.files.prompt, 'utf8'), /Use only the provided compressed source records/);
  } finally {
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('character memory tools import, query, context, and export chat-local memories', async () => {
  const { appDatabase, chat } = createTestChat();
  const store = new CharacterMemoryStore({
    appDatabase,
    trace: false
  });
  const manager = new ToolPluginManager({ trace: false });
  manager.createPlugin(CHARACTER_MEMORY_PLUGIN, {
    handlers: createCharacterMemoryHandlers({ store })
  });

  try {
    const imported = await manager.executeTool('system.character_memory.import_document', {
      chatSessionId: chat.id,
      format: 'yaml',
      text: [
        'characterMemories:',
        '  - id: charmem_npc_mira_promise_manual',
        '    characterId: npc_mira',
        '    name: 米拉',
        '    memoryType: promise',
        '    summary: 玩家答应为米拉保守男爵相关秘密。',
        '    importance: 0.9',
        '    emotionalWeight: 0.7',
        '  - characterId: npc_guard',
        '    name: 守卫',
        '    memoryType: misunderstanding',
        '    summary: 守卫怀疑玩家在替米拉办事。'
      ].join('\n')
    });
    assert.equal(imported.output.count, 2);

    const listed = await manager.executeTool('system.character_memory.list_memories', {
      chatSessionId: chat.id,
      characterId: 'npc_mira',
      query: '男爵'
    });
    assert.equal(listed.output.records.length, 1);
    assert.equal(listed.output.records[0].data.memoryType, 'promise');

    const context = await manager.executeTool('system.character_memory.get_prompt_context', {
      chatSessionId: chat.id,
      characterIds: ['npc_mira'],
      limitPerCharacter: 3
    });
    assert.match(context.output.context, /米拉/);
    assert.match(context.output.context, /保守男爵/);

    const exported = await manager.executeTool('system.character_memory.export_document', {
      chatSessionId: chat.id,
      format: 'json',
      characterId: 'npc_mira'
    });
    assert.match(exported.output.text, /characterMemories/);
    assert.equal(exported.output.payload.characterMemories.length, 1);
  } finally {
    appDatabase.close();
  }
});

test('default tool plugin manager registers character memory when app database exists', () => {
  const { appDatabase } = createTestChat();
  try {
    const manager = createDefaultToolPluginManager({ appDatabase, trace: false });
    const tool = manager.getTool('system.character_memory.get_prompt_context');
    assert.equal(tool.name, 'get_prompt_context');
    assert.equal(tool.mutatesState, false);
  } finally {
    appDatabase.close();
  }
});
