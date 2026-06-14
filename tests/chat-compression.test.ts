// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppDatabase,
  CHAT_COMPRESSION_PLUGIN,
  ChatCompressionMemory,
  ToolPluginManager,
  createChatCompressionHandlers,
  createDefaultToolPluginManager,
  extractChatCompressionUpdates,
  stripChatCompressionUpdates
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
    title: 'Compression Test',
    includeGreeting: false
  }).session;
  const messages = [
    appDatabase.addChatMessage(chat.id, {
      role: 'user',
      name: 'Player',
      content: '我和米拉在钟楼门厅见面，答应帮她找银钥匙。'
    }),
    appDatabase.addChatMessage(chat.id, {
      role: 'assistant',
      name: 'Test GM',
      content: '米拉说银钥匙在旧市场，她担心守卫已经被收买。'
    }),
    appDatabase.addChatMessage(chat.id, {
      role: 'user',
      name: 'Player',
      content: '我承诺不会告诉男爵，并准备去旧市场。'
    })
  ];
  return { appDatabase, chat, messages };
}

test('chat compression extracts, strips, stores, and builds prompt context', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-chat-compression-'));
  const { appDatabase, chat, messages } = createTestChat();
  const memory = new ChatCompressionMemory({
    appDatabase,
    trace: {
      directory: join(directory, 'traces')
    }
  });

  try {
    const content = [
      '压缩完成。',
      '<AI_DND_CHAT_COMPRESSION>',
      JSON.stringify({
        summaries: [
          {
            type: 'segment_summary',
            title: '钟楼门厅约定',
            summary: '玩家在钟楼门厅见到米拉，并答应帮她寻找旧市场的银钥匙。',
            facts: [
              { id: 'fact_silver_key', text: '银钥匙在旧市场。', importance: 0.9 }
            ],
            openThreads: [
              { id: 'thread_find_key', summary: '玩家需要前往旧市场寻找银钥匙。', status: 'open' }
            ],
            npcNotes: [
              { npcId: 'npc_mira', name: '米拉', summary: '担心守卫已被收买。' }
            ],
            sourceMessageIds: messages.map((message) => message.id),
            fromMessageId: messages[0].id,
            toMessageId: messages[2].id,
            fromOrderIndex: messages[0].orderIndex,
            toOrderIndex: messages[2].orderIndex,
            importance: 0.7
          },
          {
            type: 'pinned_fact',
            title: '对米拉的承诺',
            summary: '玩家承诺不会把米拉的计划告诉男爵。',
            importance: 0.95
          }
        ]
      }),
      '</AI_DND_CHAT_COMPRESSION>'
    ].join('\n');

    const extracted = extractChatCompressionUpdates(content);
    assert.equal(extracted.updates.length, 1);
    assert.equal(stripChatCompressionUpdates(content), '压缩完成。');

    const applied = memory.applyModelOutput(chat.id, content);
    assert.equal(applied.content, '压缩完成。');
    assert.equal(applied.updated, true);
    assert.equal(applied.records.length, 2);
    assert.equal(applied.records[0].data.type, 'segment_summary');
    assert.equal(applied.records[0].data.facts[0].id, 'fact_silver_key');
    assert.equal(applied.records[1].data.type, 'pinned_fact');
    assert.equal(existsSync(applied.trace.files.input), true);
    assert.equal(existsSync(applied.trace.files.stateAfter), true);

    const context = memory.getPromptContext(chat.id, {
      recentMessageCount: 1,
      summaryLimit: 5,
      pinnedLimit: 5
    });
    assert.match(context.context, /钟楼门厅/);
    assert.match(context.context, /对米拉的承诺/);
    assert.match(context.context, /Recent raw messages/);
    assert.equal(context.sections.recentMessages.length, 1);
    assert.ok(context.tokenEstimate > 0);

    const prompt = memory.buildPrompt(chat.id, {
      recentCount: 2,
      includeExistingContext: true
    });
    assert.match(prompt.prompt, /AI_DND_CHAT_COMPRESSION/);
    assert.match(prompt.prompt, /Source messages/);
    assert.equal(prompt.messages.length, 2);
    assert.equal(existsSync(prompt.trace.files.prompt), true);
    assert.match(readFileSync(prompt.trace.files.prompt, 'utf8'), /raw chat_messages database is the source of truth/i);
  } finally {
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('chat compression imports, exports, and uses tool plugin handlers', async () => {
  const { appDatabase, chat } = createTestChat();
  const memory = new ChatCompressionMemory({
    appDatabase,
    trace: false
  });
  const manager = new ToolPluginManager({ trace: false });
  manager.createPlugin(CHAT_COMPRESSION_PLUGIN, {
    handlers: createChatCompressionHandlers({ memory })
  });

  try {
    const imported = await manager.executeTool('system.chat_compression.import_document', {
      chatSessionId: chat.id,
      format: 'yaml',
      text: [
        'chatCompressions:',
        '  - id: chatcomp_rolling_active',
        '    type: rolling_summary',
        '    title: 当前总览',
        '    summary: 玩家正在帮助米拉寻找银钥匙。',
        '    importance: 0.9',
        '  - type: pinned_fact',
        '    title: 男爵保密',
        '    summary: 玩家答应不向男爵泄露米拉的计划。'
      ].join('\n')
    });
    assert.equal(imported.output.count, 2);

    const listed = await manager.executeTool('system.chat_compression.list_summaries', {
      chatSessionId: chat.id,
      query: '男爵'
    });
    assert.equal(listed.output.records.length, 1);
    assert.equal(listed.output.records[0].data.type, 'pinned_fact');

    const context = await manager.executeTool('system.chat_compression.get_prompt_context', {
      chatSessionId: chat.id,
      recentMessageCount: 0
    });
    assert.match(context.output.context, /玩家正在帮助米拉/);
    assert.match(context.output.context, /男爵保密/);

    const exported = await manager.executeTool('system.chat_compression.export_document', {
      chatSessionId: chat.id,
      format: 'json'
    });
    assert.match(exported.output.text, /chatCompressions/);
    assert.equal(exported.output.payload.chatCompressions.length, 2);
  } finally {
    appDatabase.close();
  }
});

test('default tool plugin manager registers chat compression when app database exists', () => {
  const { appDatabase } = createTestChat();
  try {
    const manager = createDefaultToolPluginManager({ appDatabase, trace: false });
    const tool = manager.getTool('system.chat_compression.get_prompt_context');
    assert.equal(tool.name, 'get_prompt_context');
    assert.equal(tool.mutatesState, false);
  } finally {
    appDatabase.close();
  }
});
