// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MechanicsRegistry,
  SQLiteDataManager,
  createDefaultToolPluginManager
} from '../src/index.js';

test('mechanics registry manages skills, statuses, and feats with import/export', () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:', schemaDirectory: null });
  const registry = new MechanicsRegistry({ dataManager });

  const skill = registry.upsertSkill({
    id: 'lockpick',
    name: '开锁',
    ability: 'dex',
    tags: ['exploration', 'tool'],
    mechanicalEffect: '+2 when using thieves tools.',
    numericValues: {
      toolBonus: '2',
      trainingCost: 1
    }
  });
  const status = registry.upsertStatus({
    id: 'poisoned',
    name: '中毒',
    severity: 'moderate',
    durationType: 'timed',
    mechanicalEffect: 'Disadvantage on strength checks.'
  });
  const feat = registry.upsertFeat({
    id: 'alert',
    name: '警觉',
    tier: 'novice',
    grants: ['initiative_bonus']
  });

  assert.equal(skill.data.ability, 'dex');
  assert.deepEqual(skill.data.numericValues, { toolBonus: 2, trainingCost: 1 });
  assert.equal(status.data.durationType, 'timed');
  assert.deepEqual(feat.data.grants, ['initiative_bonus']);

  const listed = registry.listSkills({ query: '开锁' });
  assert.equal(listed.records.length, 1);

  registry.patchSkill('lockpick', { category: 'exploration' });
  assert.equal(registry.getSkill('lockpick').data.category, 'exploration');

  const imported = registry.importDocument({
    format: 'json',
    text: JSON.stringify({
      skills: [{ id: 'athletics', name: '运动', ability: 'str' }],
      statuses: [{ id: 'blessed', name: '祝福', category: 'buff' }],
      feats: [{ id: 'duelist', name: '决斗者', category: 'combat' }]
    })
  });
  assert.equal(imported.counts.skills, 1);
  assert.equal(imported.counts.statuses, 1);
  assert.equal(imported.counts.feats, 1);

  const exported = registry.exportDocument({ format: 'json' });
  assert.equal(exported.payload.skills.some((entry) => entry.id === 'athletics'), true);
  assert.equal(exported.payload.statuses.some((entry) => entry.id === 'blessed'), true);
  assert.equal(exported.payload.feats.some((entry) => entry.id === 'duelist'), true);

  assert.equal(registry.deleteFeat('duelist').deleted, true);
  dataManager.close();
});

test('mechanics registry exposes template-only mechanics without creating collections', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:', schemaDirectory: null });
  const registry = new MechanicsRegistry({ dataManager });

  const listed = registry.listTemplates({ includeFields: false, includeExamples: false });
  assert.equal(listed.templates.some((template) => template.id === 'skill' && template.registered), true);
  assert.equal(listed.templates.some((template) => template.id === 'class' && template.templateOnly), true);
  assert.equal(listed.templates.some((template) => template.id === 'race' && template.templateOnly), true);

  const registered = registry.listTemplates({ registeredOnly: true, includeFields: false, includeExamples: false });
  assert.deepEqual(registered.templates.map((template) => template.id).sort(), ['feat', 'skill', 'status']);

  const classTemplate = registry.getTemplate('jobs');
  assert.equal(classTemplate.id, 'class');
  assert.equal(classTemplate.registered, false);
  assert.equal(classTemplate.suggestedCollection, 'class_registry');
  assert.equal(classTemplate.fields.some((field) => field.name === 'levelProgression'), true);
  assert.equal(dataManager.listCollections().includes('class_registry'), false);

  const manager = createDefaultToolPluginManager({ dataManager, trace: false });
  const raceTemplate = await manager.executeTool('system.mechanics_registry.get_template', {
    templateId: 'ancestry',
    includeFields: false,
    includeExamples: false
  });
  assert.equal(raceTemplate.output.id, 'race');
  assert.equal(raceTemplate.output.fields, undefined);

  dataManager.close();
});

test('mechanics registry quantifies agent-authored fuzzy mechanics settings', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:', schemaDirectory: null });
  const manager = createDefaultToolPluginManager({ dataManager, trace: false });

  const written = await manager.executeTool('system.mechanics_registry.upsert_status', {
    id: 'silver_burn',
    name: '银焰灼烧',
    description: '这是一种很严重的灼烧，持续三回合，伤口周围会出现银色诅咒纹路。',
    quantificationDefinition: {
      prompt: '将状态设定中的强度和持续时间转换为数值；特殊纹路作为文本设定保存。',
      numericFields: [
        {
          name: 'severityScore',
          type: 'integer',
          min: 0,
          max: 10,
          defaultValue: 0,
          references: [
            { label: '严重', value: 8, keywords: ['很严重'] }
          ]
        },
        {
          name: 'durationRounds',
          type: 'integer',
          min: 1,
          max: 10,
          defaultValue: 1,
          references: [
            { label: '三回合', value: 3, keywords: ['三回合'] }
          ]
        }
      ],
      textFields: [
        {
          name: 'specialNote',
          textMode: 'matched',
          references: [
            { label: '银色诅咒', keywords: ['银色诅咒纹路'], text: '伤口周围出现银色诅咒纹路' }
          ]
        }
      ]
    }
  }, undefined, {
    authorization: true,
    actor: 'agent'
  });

  assert.deepEqual(written.output.data.numericValues, {
    severityScore: 8,
    durationRounds: 3
  });
  assert.deepEqual(written.output.data.textSettings, {
    specialNote: '伤口周围出现银色诅咒纹路'
  });
  assert.equal(written.output.data.quantificationAudit.trigger, 'agent_authored');
  assert.equal(written.output.data.quantificationAudit.decisions.length, 3);

  dataManager.close();
});

test('mechanics registry sync API rejects quantification to avoid divergent paths', () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:', schemaDirectory: null });
  const registry = new MechanicsRegistry({ dataManager });

  assert.throws(
    () => registry.upsertStatus({
      id: 'sync_quantify',
      name: '同步量化',
      description: '很严重的状态。',
      quantify: true,
      quantificationDefinition: {
        numericFields: [
          {
            name: 'severityScore',
            type: 'integer',
            references: [
              { label: '严重', value: 8, keywords: ['严重'] }
            ]
          }
        ]
      }
    }),
    /unified async quantification path/
  );

  dataManager.close();
});

test('mechanics registry agent creation can use LLM numeric reference material', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:', schemaDirectory: null });
  const chatProvider = {
    async generate() {
      return {
        content: JSON.stringify({
          field: 'attackBonus',
          mode: 'numeric',
          value: 4,
          confidence: 0.85,
          reason: 'Reference table maps master sword style to +4.',
          referencesUsed: ['combat-bonus-scale']
        })
      };
    }
  };
  const manager = createDefaultToolPluginManager({ dataManager, chatProvider, trace: false });

  const written = await manager.executeTool('system.mechanics_registry.upsert_feat', {
    id: 'master_sword_style',
    name: '剑圣架势',
    description: '熟练到接近大师级的剑术架势。',
    quantificationDefinition: {
      prompt: '根据战斗加值表量化专长效果。',
      numericFields: [
        { name: 'attackBonus', type: 'integer', min: 0, max: 10 }
      ],
      referenceDocuments: [
        {
          name: 'combat-bonus-scale',
          fields: ['attackBonus'],
          text: '战斗加值参考：入门+1，熟练+2，大师级+4，传奇+6。'
        }
      ]
    }
  }, undefined, {
    authorization: true,
    actor: 'agent'
  });

  assert.deepEqual(written.output.data.numericValues, { attackBonus: 4 });
  assert.equal(written.output.data.quantificationAudit.llm.used, true);

  dataManager.close();
});

test('mechanics registry tools require user authorization for writes', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:', schemaDirectory: null });
  const manager = createDefaultToolPluginManager({ dataManager, trace: false });

  const listed = await manager.executeTool('system.mechanics_registry.list_skills', {});
  assert.equal(listed.output.records.length, 0);

  await assert.rejects(
    () => manager.executeTool('system.mechanics_registry.upsert_skill', {
      id: 'stealth',
      name: '潜行'
    }),
    /requires explicit user authorization/
  );

  const written = await manager.executeTool('system.mechanics_registry.upsert_skill', {
    id: 'stealth',
    name: '潜行',
    ability: 'dex'
  }, undefined, {
    authorization: true
  });
  assert.equal(written.output.id, 'stealth');

  const found = await manager.executeTool('system.mechanics_registry.get_skill', {
    id: 'stealth'
  });
  assert.equal(found.output.data.name, '潜行');

  await assert.rejects(
    () => manager.executeTool('system.mechanics_registry.delete_skill', { id: 'stealth' }),
    /requires explicit user authorization/
  );

  const deleted = await manager.executeTool('system.mechanics_registry.delete_skill', { id: 'stealth' }, undefined, {
    authorization: true
  });
  assert.equal(deleted.output.deleted, true);
  dataManager.close();
});
