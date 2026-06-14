// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppDatabase,
  MAP_STATE_PLUGIN,
  MapStructuredStateDatabase,
  ToolPluginManager,
  buildMapStructuredStatePrompt,
  createMapStateHandlers,
  extractMapStructuredStateUpdates,
  stripMapStructuredStateUpdates
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
    title: 'Map State Test',
    includeGreeting: false
  }).session;
  return { appDatabase, chat };
}

test('map structured state extracts, strips, and stores map exploration updates', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-map-state-'));
  const { appDatabase, chat } = createTestChat();
  const database = new MapStructuredStateDatabase({
    appDatabase,
    trace: {
      directory: join(directory, 'traces')
    }
  });

  try {
    const content = [
      '你掀开蓝色摊棚下方的松动木板。',
      '<AI_DND_MAP_STATE>',
      JSON.stringify({
        mode: 'patch',
        sceneId: 'market',
        maps: [
          {
            mapId: 'old_market',
            name: '旧市场',
            position: { areaId: 'blue_stall', label: '蓝色摊棚' },
            areas: [
              { id: 'blue_stall', name: '蓝色摊棚', discovered: true, summary: '摊棚下有松动木板。' }
            ],
            exits: [
              { id: 'north_alley', name: '北侧小巷', toMapId: 'north_alley', status: 'open' }
            ],
            objects: [
              { id: 'loose_board', name: '松动木板', status: 'visible', summary: '下面藏着东西。' }
            ],
            hazards: [
              { id: 'patrol_route', name: '巡逻路线', active: true, severity: 2 }
            ],
            fogOfWar: {
              exploredAreaIds: ['blue_stall']
            },
            routes: [
              { id: 'stall_to_alley', fromAreaId: 'blue_stall', toAreaId: 'north_alley', status: 'open' }
            ],
            values: {
              lightLevel: '3',
              alertLevel: 1
            }
          }
        ]
      }),
      '</AI_DND_MAP_STATE>'
    ].join('\n');

    const extracted = extractMapStructuredStateUpdates(content);
    assert.equal(extracted.updates.length, 1);
    assert.equal(stripMapStructuredStateUpdates(content), '你掀开蓝色摊棚下方的松动木板。');

    const applied = database.applyModelOutput(chat.id, content, { sceneId: 'market' });
    assert.equal(applied.content, '你掀开蓝色摊棚下方的松动木板。');
    assert.equal(applied.updated, true);
    assert.equal(applied.records[0].data.values.lightLevel, 3);
    assert.equal(applied.records[0].data.areas[0].id, 'blue_stall');
    assert.equal(applied.records[0].data.objects[0].id, 'loose_board');
    assert.equal(existsSync(applied.trace.files.input), true);
    assert.equal(existsSync(applied.trace.files.stateAfter), true);

    const patched = database.patchMapState({
      chatSessionId: chat.id,
      sceneId: 'market',
      mapId: 'old_market',
      values: {
        alertLevel: 2,
        lightLevel: null
      },
      objects: [
        { id: 'loose_board', status: 'opened' },
        { id: 'silver_key_cache', name: '银钥匙暗格', status: 'revealed' }
      ],
      hazards: [
        { id: 'patrol_route', _delete: true }
      ]
    });

    assert.equal(patched.record.data.values.alertLevel, 2);
    assert.equal(Object.hasOwn(patched.record.data.values, 'lightLevel'), false);
    assert.equal(patched.record.data.objects.length, 2);
    assert.equal(patched.record.data.hazards.length, 0);

    const prompt = buildMapStructuredStatePrompt({ state: patched.state });
    assert.match(prompt, /AI_DND_MAP_STATE/);
    assert.match(prompt, /values object must contain numbers only/i);
  } finally {
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('map structured state rejects non-numeric values', () => {
  const { appDatabase, chat } = createTestChat();
  const database = new MapStructuredStateDatabase({
    appDatabase,
    trace: false
  });

  assert.throws(
    () => database.patchMapState({
      chatSessionId: chat.id,
      sceneId: 'market',
      mapId: 'old_market',
      values: {
        alertLevel: 'high'
      }
    }),
    /must be finite/
  );

  appDatabase.close();
});

test('map structured state tools import, prompt, query, and export chat-local records', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-map-state-tools-'));
  const { appDatabase, chat } = createTestChat();
  const database = new MapStructuredStateDatabase({
    appDatabase,
    trace: {
      directory: join(directory, 'traces')
    }
  });
  const manager = new ToolPluginManager({ trace: false });
  manager.createPlugin(MAP_STATE_PLUGIN, {
    handlers: createMapStateHandlers({ database })
  });

  try {
    const imported = await manager.executeTool('system.map_state.import_document', {
      chatSessionId: chat.id,
      sceneId: 'market',
      format: 'yaml',
      text: [
        'mapStates:',
        '  - mapId: old_market',
        '    name: 旧市场',
        '    position:',
        '      areaId: gate',
        '      label: 市场门口',
        '    areas:',
        '      - id: gate',
        '        name: 市场门口',
        '        discovered: true',
        '    values:',
        '      alertLevel: 1'
      ].join('\n')
    });
    assert.equal(imported.output.count, 1);

    const listed = await manager.executeTool('system.map_state.list_states', {
      chatSessionId: chat.id,
      sceneId: 'market',
      query: '市场'
    });
    assert.equal(listed.output.records.length, 1);
    assert.equal(listed.output.records[0].data.values.alertLevel, 1);

    const prompt = await manager.executeTool('system.map_state.build_prompt', {
      chatSessionId: chat.id,
      sceneId: 'market'
    });
    assert.match(prompt.output.prompt, /AI_DND_MAP_STATE/);
    assert.equal(existsSync(prompt.output.trace.files.prompt), true);
    assert.match(readFileSync(prompt.output.trace.files.prompt, 'utf8'), /Current map structured state/);

    const exported = await manager.executeTool('system.map_state.export_document', {
      chatSessionId: chat.id,
      sceneId: 'market',
      format: 'json'
    });
    assert.match(exported.output.text, /old_market/);
    assert.equal(exported.output.payload.mapStates[0].position.label, '市场门口');
  } finally {
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
