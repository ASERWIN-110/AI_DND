// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RulePackManager,
  SQLiteDataManager,
  createDefaultToolPluginManager
} from '../src/index.js';

test('rule pack manager stores packs/templates and composes tool defaults', () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:', schemaDirectory: null });
  const rules = new RulePackManager({ dataManager });

  const pack = rules.upsertRulePack({
    id: 'gritty_homebrew',
    name: 'Gritty Homebrew',
    priority: 10,
    tags: ['homebrew', 'gritty'],
    diceDefaults: {
      diceSides: 12,
      criticalMode: 'maxTotal'
    },
    damageRules: {
      resistanceMultiplier: 0.75
    },
    deathRules: {
      instantDeath: false,
      deathSaveFailuresFromDamageAtZero: 2
    },
    skillFields: [
      { name: 'stressCost', type: 'integer' }
    ],
    questRewardStyle: {
      principles: ['Low coin, high consequence.']
    }
  });
  assert.equal(pack.data.diceDefaults.diceSides, 12);

  const template = rules.upsertTemplate({
    id: 'gritty_rewards',
    name: 'Gritty Rewards',
    category: 'questReward',
    templateType: 'promptSection',
    template: {
      rewardStyle: 'Favor debts and scarce supplies.'
    }
  });
  assert.equal(template.data.category, 'questReward');

  const listed = rules.listRulePacks({ query: 'gritty', includeBuiltIn: false });
  assert.equal(listed.records.length, 1);

  const composed = rules.composeRulePack({
    packIds: ['gritty_homebrew'],
    templateIds: ['gritty_rewards'],
    overrides: {
      diceDefaults: { modifier: 2 }
    }
  });
  assert.equal(composed.noLlm, true);
  assert.equal(composed.rulePack.diceDefaults.diceSides, 12);
  assert.equal(composed.rulePack.diceDefaults.modifier, 2);
  assert.equal(composed.rulePack.actionEconomy.action.max, 1);
  assert.equal(composed.rulePack.toolDefaults.effectSettlement.rules.resistanceMultiplier, 0.75);
  assert.equal(composed.rulePack.toolDefaults.effectSettlement.rules.instantDeath, false);
  assert.equal(composed.templates.some((entry) => entry.data?.name === 'Gritty Rewards'), true);

  const classTemplate = rules.getTemplate('class');
  assert.equal(classTemplate.id, 'class_database_schema');
  assert.equal(classTemplate.data.templateType, 'databaseSchema');
  assert.equal(classTemplate.data.template.fields.some((field) => field.name === 'levelProgression'), true);

  const createdCollection = rules.createCollectionFromTemplate({
    templateId: 'class',
    seedExample: true
  });
  assert.equal(createdCollection.collection, 'class_registry');
  assert.equal(dataManager.hasCollection('class_registry'), true);
  assert.equal(dataManager.describeCollection('class_registry').fields.some((field) => field.name === 'levelProgression'), true);
  assert.equal(dataManager.getRecord('class_registry', 'fighter').data.name, '战士');

  const graphTemplate = rules.getTemplate('graph');
  assert.equal(graphTemplate.id, 'relationship_graph_database_schema');
  assert.equal(graphTemplate.data.metadata.multiCollectionDatabaseTemplate, true);
  assert.equal(graphTemplate.data.template.collections.length, 3);
  assert.equal(graphTemplate.data.template.collections.some((collection) => collection.role === 'edges'), true);

  const createdGraph = rules.createCollectionFromTemplate({
    templateId: 'relationship_graph',
    collection: 'story_web',
    seedExample: true
  });
  assert.equal(createdGraph.multiCollection, true);
  assert.deepEqual(createdGraph.collections.map((collection) => collection.collection).sort(), [
    'story_web_edges',
    'story_web_memberships',
    'story_web_nodes'
  ]);
  assert.equal(dataManager.hasCollection('story_web_nodes'), true);
  assert.equal(dataManager.hasCollection('story_web_edges'), true);
  assert.equal(dataManager.hasCollection('story_web_memberships'), true);
  assert.equal(dataManager.describeCollection('story_web_edges').fields.some((field) => field.name === 'fromNodeId'), true);
  assert.equal(dataManager.getRecord('story_web_nodes', 'node_old_watch').data.nodeType, 'faction');

  const imported = rules.importDocument({
    format: 'json',
    text: JSON.stringify({
      rulePacks: [{
        id: 'heroic',
        name: 'Heroic',
        diceDefaults: { inspirationPoints: 2 },
        questRewardStyle: { principles: ['Big hero rewards.'] }
      }],
      templates: [{
        id: 'heroic_status_fields',
        name: 'Heroic Status Fields',
        category: 'mechanics',
        template: { statusFields: [{ name: 'glory', type: 'integer' }] }
      }]
    })
  });
  assert.equal(imported.counts.rulePacks, 1);
  assert.equal(imported.counts.templates, 1);

  const exported = rules.exportDocument({ format: 'json', includeBuiltIn: false });
  assert.equal(exported.payload.rulePacks.some((entry) => entry.id === 'heroic'), true);
  assert.equal(exported.payload.templates.some((entry) => entry.id === 'heroic_status_fields'), true);

  dataManager.close();
});

test('rule pack tools require authorization for writes and register by default', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:', schemaDirectory: null });
  const tools = createDefaultToolPluginManager({ dataManager, trace: false });

  const described = await tools.executeTool('system.rule_packs.describe_manager', {});
  assert.equal(described.output.noLlm, true);

  const listed = await tools.executeTool('system.rule_packs.list_rule_packs', {
    query: 'default'
  });
  assert.equal(listed.output.records.some((record) => record.id === 'dnd_lite_default'), true);

  await assert.rejects(
    () => tools.executeTool('system.rule_packs.upsert_rule_pack', {
      id: 'unauthorized',
      name: 'Unauthorized'
    }),
    /requires explicit user authorization/
  );

  const written = await tools.executeTool('system.rule_packs.upsert_rule_pack', {
    id: 'table_default',
    name: 'Table Default',
    diceDefaults: { diceSides: 20 },
    questRewardStyle: { principles: ['Reward risk.'] }
  }, undefined, {
    authorization: true
  });
  assert.equal(written.output.id, 'table_default');

  const composed = await tools.executeTool('system.rule_packs.compose_rule_pack', {
    packIds: ['table_default']
  });
  assert.equal(composed.output.rulePack.toolDefaults.diceCheck.diceSides, 20);
  assert.equal(tools.getTool('system.rule_packs.compose_rule_pack').pluginId, 'system.rule_packs');

  await assert.rejects(
    () => tools.executeTool('system.rule_packs.create_collection_from_template', { templateId: 'race' }),
    /requires explicit user authorization/
  );

  const created = await tools.executeTool('system.rule_packs.create_collection_from_template', {
    templateId: 'race',
    collection: 'race_registry'
  }, undefined, {
    authorization: true
  });
  assert.equal(created.output.collection, 'race_registry');
  assert.equal(dataManager.hasCollection('race_registry'), true);

  await assert.rejects(
    () => tools.executeTool('system.rule_packs.delete_rule_pack', { id: 'table_default' }),
    /requires explicit user authorization/
  );

  const deleted = await tools.executeTool('system.rule_packs.delete_rule_pack', { id: 'table_default' }, undefined, {
    authorization: true
  });
  assert.equal(deleted.output.deleted, true);

  dataManager.close();
});
