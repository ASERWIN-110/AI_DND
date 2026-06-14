// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppDatabase,
  NPC_STATE_PLUGIN,
  NpcStructuredStateDatabase,
  ToolPluginManager,
  buildNpcStructuredStatePrompt,
  createNpcStateHandlers,
  extractNpcStructuredStateUpdates,
  stripNpcStructuredStateUpdates
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
    title: 'NPC State Test',
    includeGreeting: false
  }).session;
  return { appDatabase, chat };
}

test('npc structured state extracts, strips, and stores numeric/status/inventory updates', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-npc-state-'));
  const { appDatabase, chat } = createTestChat();
  const database = new NpcStructuredStateDatabase({
    appDatabase,
    trace: {
      directory: join(directory, 'traces')
    }
  });

  try {
    const content = [
      '守卫咬牙后退半步。',
      '<AI_DND_NPC_STATE>',
      JSON.stringify({
        mode: 'patch',
        sceneId: 'gate',
        npcs: [
          {
            npcId: 'npc_guard',
            name: 'Gate Guard',
            values: {
              hp: 7,
              maxHp: 10,
              morale: '4'
            },
            specialStatuses: [
              { id: 'bleeding', name: '流血', stacks: 1, remainingTurns: 3 }
            ],
            inventory: {
              currency: { copper: 5 },
              items: [{ id: 'spear', name: '长矛', quantity: 1, equipped: true }]
            }
          }
        ]
      }),
      '</AI_DND_NPC_STATE>'
    ].join('\n');

    const extracted = extractNpcStructuredStateUpdates(content);
    assert.equal(extracted.updates.length, 1);
    assert.equal(stripNpcStructuredStateUpdates(content), '守卫咬牙后退半步。');

    const applied = database.applyModelOutput(chat.id, content, { sceneId: 'gate' });
    assert.equal(applied.content, '守卫咬牙后退半步。');
    assert.equal(applied.updated, true);
    assert.equal(applied.records[0].data.values.hp, 7);
    assert.equal(applied.records[0].data.values.morale, 4);
    assert.equal(applied.records[0].data.specialStatuses[0].id, 'bleeding');
    assert.equal(applied.records[0].data.inventory.items[0].equipped, true);
    assert.equal(existsSync(applied.trace.files.input), true);
    assert.equal(existsSync(applied.trace.files.stateAfter), true);

    const patched = database.patchNpcState({
      chatSessionId: chat.id,
      sceneId: 'gate',
      npcId: 'npc_guard',
      values: {
        hp: 5,
        morale: null
      },
      specialStatuses: [
        { id: 'bleeding', remainingTurns: 2 },
        { id: 'frightened', name: '惊惧', intensity: 2 }
      ],
      inventory: {
        items: [
          { id: 'spear', quantity: 0, _delete: true },
          { id: 'keyring', name: '钥匙串', quantity: 1 }
        ]
      }
    });

    assert.equal(patched.record.data.values.hp, 5);
    assert.equal(Object.hasOwn(patched.record.data.values, 'morale'), false);
    assert.equal(patched.record.data.specialStatuses.length, 2);
    assert.equal(patched.record.data.specialStatuses.find((status) => status.id === 'bleeding').remainingTurns, 2);
    assert.equal(patched.record.data.inventory.items.length, 1);
    assert.equal(patched.record.data.inventory.items[0].id, 'keyring');

    const prompt = buildNpcStructuredStatePrompt({ state: patched.state });
    assert.match(prompt, /AI_DND_NPC_STATE/);
    assert.match(prompt, /values object must contain numbers only/i);
  } finally {
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('npc structured state rejects non-numeric values', () => {
  const { appDatabase, chat } = createTestChat();
  const database = new NpcStructuredStateDatabase({
    appDatabase,
    trace: false
  });

  assert.throws(
    () => database.patchNpcState({
      chatSessionId: chat.id,
      sceneId: 'gate',
      npcId: 'npc_guard',
      values: {
        hp: 'wounded'
      }
    }),
    /must be finite/
  );

  appDatabase.close();
});

test('npc structured state tools import, prompt, query, and export chat-local database records', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-npc-state-tools-'));
  const { appDatabase, chat } = createTestChat();
  const database = new NpcStructuredStateDatabase({
    appDatabase,
    trace: {
      directory: join(directory, 'traces')
    }
  });
  const manager = new ToolPluginManager({ trace: false });
  manager.createPlugin(NPC_STATE_PLUGIN, {
    handlers: createNpcStateHandlers({ database })
  });

  try {
    const imported = await manager.executeTool('system.npc_state.import_document', {
      chatSessionId: chat.id,
      sceneId: 'market',
      format: 'yaml',
      text: [
        'npcStates:',
        '  - npcId: npc_vendor',
        '    name: Old Vendor',
        '    values:',
        '      suspicion: 2',
        '      patience: 8',
        '    specialStatuses:',
        '      - id: bargaining',
        '        name: 议价中',
        '        intensity: 1',
        '    inventory:',
        '      currency:',
        '        gold: 12',
        '      items:',
        '        - id: apple',
        '          name: 苹果',
        '          quantity: 6'
      ].join('\n')
    });
    assert.equal(imported.output.count, 1);

    const listed = await manager.executeTool('system.npc_state.list_states', {
      chatSessionId: chat.id,
      sceneId: 'market',
      query: 'vendor'
    });
    assert.equal(listed.output.records.length, 1);
    assert.equal(listed.output.records[0].data.values.patience, 8);

    const prompt = await manager.executeTool('system.npc_state.build_prompt', {
      chatSessionId: chat.id,
      sceneId: 'market'
    });
    assert.match(prompt.output.prompt, /AI_DND_NPC_STATE/);
    assert.equal(existsSync(prompt.output.trace.files.prompt), true);
    assert.match(readFileSync(prompt.output.trace.files.prompt, 'utf8'), /Current NPC structured state/);

    const exported = await manager.executeTool('system.npc_state.export_document', {
      chatSessionId: chat.id,
      sceneId: 'market',
      format: 'json'
    });
    assert.match(exported.output.text, /npc_vendor/);
    assert.equal(exported.output.payload.npcStates[0].inventory.items[0].name, '苹果');
  } finally {
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
