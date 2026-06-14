// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  SQLiteDataManager,
  createDataHandlers,
  importDocumentToDataManager,
  ToolPluginManager,
  DATA_PLUGIN
} from '../src/index.js';

test('sqlite data manager auto-creates collection and fields', () => {
  const data = new SQLiteDataManager({ databasePath: ':memory:' });

  const record = data.upsertRecord('characters', {
    name: 'Astarion',
    hp: 17,
    active: true,
    tags: ['npc', 'rogue']
  }, {
    id: 'npc-1'
  });

  assert.equal(record.id, 'npc-1');
  assert.equal(record.data.name, 'Astarion');

  const description = data.describeCollection('characters');
  assert.equal(description.exists, true);
  assert.ok(description.fields.some((field) => field.name === 'name' && field.type === 'TEXT'));
  assert.ok(description.fields.some((field) => field.name === 'hp' && field.type === 'INTEGER'));
  assert.ok(description.fields.some((field) => field.name === 'active' && field.type === 'INTEGER'));

  data.close();
});

test('sqlite data manager patches records and adds new fields', () => {
  const data = new SQLiteDataManager({ databasePath: ':memory:' });

  data.upsertRecord('party', { name: 'Mira', hp: 10 }, { id: 'pc-1' });
  const patched = data.patchRecord('party', 'pc-1', {
    hp: 12,
    location: 'camp'
  });

  assert.equal(patched.data.hp, 12);
  assert.equal(patched.data.location, 'camp');
  assert.ok(data.describeCollection('party').fields.some((field) => field.name === 'location'));

  data.close();
});

test('sqlite data manager queries with filters and sorting', () => {
  const data = new SQLiteDataManager({ databasePath: ':memory:' });

  data.upsertRecord('items', { name: 'Potion', value: 50, kind: 'consumable' }, { id: 'item-1' });
  data.upsertRecord('items', { name: 'Longsword', value: 150, kind: 'weapon' }, { id: 'item-2' });
  data.upsertRecord('items', { name: 'Dagger', value: 25, kind: 'weapon' }, { id: 'item-3' });

  const result = data.queryRecords('items', {
    filter: {
      kind: 'weapon',
      value: { $gte: 30 }
    },
    sort: [{ field: 'value', direction: 'desc' }],
    limit: 10
  });

  assert.deepEqual(result.records.map((record) => record.id), ['item-2']);

  data.close();
});

test('data plugin tools manage records through tool manager', async () => {
  const data = new SQLiteDataManager({ databasePath: ':memory:' });
  const manager = new ToolPluginManager();
  manager.createPlugin(DATA_PLUGIN, {
    handlers: createDataHandlers(data)
  });

  await manager.executeTool('system.data.semantic_update', {
    collection: 'quests',
    id: 'quest-1',
    text: 'The party accepted a quest to find the key.',
    values: {
      title: 'Find the key',
      status: 'active'
    }
  });

  const query = await manager.executeTool('system.data.query_fields', {
    collection: 'quests',
    fields: ['title', 'status'],
    filter: {
      status: 'active'
    }
  });

  assert.equal(query.output.records.length, 1);
  assert.equal(query.output.records[0].fields.title, 'Find the key');

  data.close();
});

test('quantify text tool scores fuzzy descriptions and stores numeric and text fields', async () => {
  const data = new SQLiteDataManager({ databasePath: ':memory:' });
  const manager = new ToolPluginManager();
  manager.createPlugin(DATA_PLUGIN, {
    handlers: createDataHandlers(data)
  });

  const quantified = await manager.executeTool('system.data.quantify_text', {
    collection: 'actor_state',
    id: 'pc-1',
    text: '角色受伤严重但仍然斗志高昂，左臂有银色诅咒纹路。',
    definition: {
      prompt: '将战斗描写量化为角色状态。伤势和士气存数字，特殊设定保留文本。',
      numericFields: [
        {
          name: 'injurySeverity',
          type: 'integer',
          min: 0,
          max: 10,
          defaultValue: 0,
          references: [
            { label: '轻伤', value: 2, keywords: ['擦伤', '轻伤'] },
            { label: '重伤', value: 8, keywords: ['受伤严重', '重伤'] }
          ],
          rules: [
            { label: '仍可行动', keywords: ['斗志高昂'], subtract: 1 }
          ]
        },
        {
          name: 'morale',
          type: 'integer',
          min: 0,
          max: 10,
          defaultValue: 5,
          references: [
            { label: '高昂', value: 8, keywords: ['斗志高昂'] }
          ]
        }
      ],
      textFields: [
        {
          name: 'specialTrait',
          textMode: 'matched',
          references: [
            {
              label: '诅咒纹路',
              keywords: ['银色诅咒纹路'],
              text: '左臂有银色诅咒纹路'
            }
          ]
        },
        {
          name: 'rawSetting',
          textMode: 'raw'
        }
      ]
    }
  });

  assert.equal(quantified.output.values.injurySeverity, 7);
  assert.equal(quantified.output.values.morale, 8);
  assert.equal(quantified.output.values.specialTrait, '左臂有银色诅咒纹路');
  assert.match(quantified.output.values.rawSetting, /受伤严重/);
  assert.equal(quantified.output.record.data.injurySeverity, 7);
  assert.equal(quantified.output.record.data.quantificationAudit.prompt, '将战斗描写量化为角色状态。伤势和士气存数字，特殊设定保留文本。');

  const queried = data.queryRecords('actor_state', {
    filter: {
      injurySeverity: { $gte: 7 }
    }
  });
  assert.equal(queried.records[0].id, 'pc-1');

  data.close();
});

test('quantify text can use LLM field-specific references and generate new fields', async () => {
  const data = new SQLiteDataManager({ databasePath: ':memory:' });
  const calls = [];
  const chatProvider = {
    async generate({ messages }) {
      const prompt = messages.at(-1).content;
      calls.push(prompt);
      if (prompt.includes('"name": "strength"')) {
        return {
          content: JSON.stringify({
            field: 'strength',
            mode: 'numeric',
            value: 16,
            confidence: 0.9,
            reason: 'Source describes a strong warrior and the character attribute reference maps strong to 16.',
            referencesUsed: ['character-scale']
          })
        };
      }
      if (prompt.includes('"name": "mapDanger"')) {
        return {
          content: JSON.stringify({
            field: 'mapDanger',
            mode: 'numeric',
            value: 2,
            confidence: 0.8,
            reason: 'Source says ordinary city alley and the map reference maps ordinary city to 2.',
            referencesUsed: ['map-scale']
          })
        };
      }
      return {
        content: JSON.stringify({
          fields: [
            {
              name: 'potionCount',
              mode: 'numeric',
              type: 'integer',
              value: 3,
              min: 0,
              max: 99,
              confidence: 0.95,
              reason: 'Source says three potions.'
            }
          ]
        })
      };
    }
  };
  const manager = new ToolPluginManager();
  manager.createPlugin(DATA_PLUGIN, {
    handlers: createDataHandlers(data, { chatProvider })
  });

  const quantified = await manager.executeTool('system.data.quantify_text', {
    collection: 'scene_actor_state',
    id: 'pc-field-refs',
    text: '强壮的战士在普通城市巷道穿行，并携带三瓶药剂。',
    useLlm: true,
    allowNewFields: true,
    definition: {
      prompt: '按字段分别参考对应数值表。',
      numericFields: [
        { name: 'strength', type: 'integer', min: 1, max: 20 },
        { name: 'mapDanger', type: 'integer', min: 0, max: 10 }
      ],
      referenceDocuments: [
        {
          name: 'character-scale',
          fields: ['strength'],
          text: '人物属性参考：孱弱=8，普通=10，强壮=16。'
        },
        {
          name: 'map-scale',
          fields: ['mapDanger'],
          text: '地图难度参考：安全=0，普通城市=2，危险荒野=6。'
        }
      ]
    }
  });

  assert.equal(quantified.output.values.strength, 16);
  assert.equal(quantified.output.values.mapDanger, 2);
  assert.equal(quantified.output.values.potionCount, 3);
  assert.equal(quantified.output.values.quantificationAudit.llm.used, true);
  assert.match(calls[0], /人物属性参考/);
  assert.doesNotMatch(calls[0], /地图难度参考/);
  assert.match(calls[1], /地图难度参考/);
  assert.doesNotMatch(calls[1], /人物属性参考/);

  data.close();
});

test('structured document importer creates collections from json and yaml', () => {
  const data = new SQLiteDataManager({ databasePath: ':memory:' });

  const jsonResult = importDocumentToDataManager(data, {
    format: 'json',
    text: JSON.stringify({
      npcs: [
        { id: 'npc-1', name: 'Mira', level: 3 },
        { id: 'npc-2', name: 'Rowan', level: 2 }
      ]
    })
  });

  assert.equal(jsonResult.imported[0].collection, 'npcs');
  assert.deepEqual(jsonResult.imported[0].ids, ['npc-1', 'npc-2']);

  const yamlResult = importDocumentToDataManager(data, {
    format: 'yaml',
    text: [
      'items:',
      '  - id: item-1',
      '    name: Silver Key',
      '    value: 25'
    ].join('\n')
  });

  assert.equal(yamlResult.imported[0].collection, 'items');
  assert.equal(data.getRecord('items', 'item-1').data.name, 'Silver Key');

  data.close();
});

test('structured document importer creates collections from xml', () => {
  const data = new SQLiteDataManager({ databasePath: ':memory:' });

  const result = importDocumentToDataManager(data, {
    format: 'xml',
    text: '<world><locations><location id="loc-1"><name>Bell Tower</name><danger>4</danger></location></locations></world>',
    collectionMap: {
      locations: 'locations'
    }
  });

  assert.ok(result.imported.some((entry) => entry.collection === 'locations'));
  assert.equal(data.getRecord('locations', 'loc-1').data.name, 'Bell Tower');

  data.close();
});

test('alter fields adds and deletes columns while syncing schema file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-dnd-data-'));
  const data = new SQLiteDataManager({
    databasePath: join(dir, 'test.sqlite'),
    schemaDirectory: join(dir, 'schemas')
  });
  const manager = new ToolPluginManager();
  manager.createPlugin(DATA_PLUGIN, {
    handlers: createDataHandlers(data)
  });

  await manager.executeTool('system.data.semantic_update', {
    collection: 'npcs',
    id: 'npc-1',
    values: {
      name: 'Mira',
      danger: 4
    }
  });

  const altered = await manager.executeTool('system.data.alter_fields', {
    collection: 'npcs',
    add: [
      {
        name: 'attitude',
        type: 'text',
        defaultValue: 'neutral',
        description: 'Relationship attitude.'
      }
    ],
    delete: ['danger'],
    reason: 'replace danger with attitude'
  });

  assert.equal(altered.output.added[0].name, 'attitude');
  assert.equal(altered.output.deleted[0].name, 'danger');
  assert.equal(existsSync(altered.output.formatFile), true);

  const schema = JSON.parse(readFileSync(altered.output.formatFile, 'utf8'));
  assert.ok(schema.fields.some((field) => field.name === 'attitude'));
  assert.equal(schema.fields.some((field) => field.name === 'danger'), false);
  assert.equal(schema.history.at(-1).reason, 'replace danger with attitude');

  const record = data.getRecord('npcs', 'npc-1');
  assert.equal(record.data.attitude, 'neutral');
  assert.equal(Object.hasOwn(record.data, 'danger'), false);

  const description = data.describeCollection('npcs');
  assert.equal(description.formatFile, altered.output.formatFile);
  assert.ok(description.format.fields.some((field) => field.name === 'attitude'));

  data.close();
});
