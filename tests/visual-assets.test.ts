// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SQLiteDataManager,
  createDefaultToolPluginManager
} from '../src/index.js';

test('visual asset tools register, stay no-op when empty, and resolve object/event bindings', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:', schemaDirectory: null });
  const tools = createDefaultToolPluginManager({ dataManager, trace: false });

  const described = await tools.executeTool('system.visual.describe_manager', {});
  assert.equal(described.output.noLlm, true);
  assert.equal(described.output.collections.assets.collection, 'visual_assets');

  const empty = await tools.executeTool('system.visual.resolve_assets', {
    targetType: 'npc',
    targetId: 'npc_mira',
    slot: 'portrait'
  });
  assert.equal(empty.output.noop, true);
  assert.equal(empty.output.assets.length, 0);
  assert.equal(empty.output.missing[0].reason, 'no_binding');

  await assert.rejects(
    () => tools.executeTool('system.visual.upsert_asset', {
      assetId: 'asset_mira_portrait',
      name: 'Mira Portrait',
      uri: '/assets/mira.png'
    }),
    /requires explicit user authorization/
  );

  await tools.executeTool('system.visual.upsert_asset', {
    assetId: 'asset_mira_portrait',
    name: 'Mira Portrait',
    assetType: 'image',
    uri: '/assets/mira.png',
    tags: ['npc', 'portrait']
  }, undefined, {
    authorization: true
  });
  await tools.executeTool('system.visual.upsert_binding', {
    bindingId: 'binding_mira_portrait',
    targetType: 'npc',
    targetId: 'npc_mira',
    slot: 'portrait',
    assetId: 'asset_mira_portrait',
    priority: 100
  }, undefined, {
    authorization: true
  });

  const resolvedNpc = await tools.executeTool('system.visual.resolve_assets', {
    targetType: 'npc',
    targetId: 'npc_mira',
    slot: 'portrait'
  });
  assert.equal(resolvedNpc.output.noop, false);
  assert.equal(resolvedNpc.output.assets[0].asset.data.uri, '/assets/mira.png');
  assert.equal(resolvedNpc.output.assets[0].binding.data.targetId, 'npc_mira');

  await tools.executeTool('system.visual.upsert_asset', {
    assetId: 'asset_d20_critical_flash',
    name: 'D20 Critical Flash',
    assetType: 'animation',
    uri: '/assets/d20-critical.webm'
  }, undefined, {
    authorization: true
  });
  await tools.executeTool('system.visual.upsert_event_binding', {
    eventBindingId: 'event_binding_d20_critical',
    eventType: 'dice_roll',
    slot: 'animation',
    assetId: 'asset_d20_critical_flash',
    priority: 100,
    conditions: { result: 'critical_success' }
  }, undefined, {
    authorization: true
  });

  const resolvedEvent = await tools.executeTool('system.visual.resolve_assets', {
    events: [{
      eventType: 'dice_roll',
      slot: 'animation',
      result: 'critical_success'
    }]
  });
  assert.equal(resolvedEvent.output.noop, false);
  assert.equal(resolvedEvent.output.assets[0].asset.data.assetId, 'asset_d20_critical_flash');
  assert.equal(resolvedEvent.output.assets[0].binding.data.eventType, 'dice_roll');

  dataManager.close();
});

test('visual asset database template is exposed through rule pack templates', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:', schemaDirectory: null });
  const tools = createDefaultToolPluginManager({ dataManager, trace: false });

  const template = await tools.executeTool('system.rule_packs.get_template', {
    id: 'visual_assets'
  });
  assert.equal(template.output.id, 'visual_assets_database_schema');
  assert.equal(template.output.data.template.templateId, 'visual_assets');
  assert.equal(template.output.data.template.collections.length, 3);
  assert.equal(template.output.data.template.collections.some((collection) => collection.role === 'eventBindings'), true);

  const created = await tools.executeTool('system.rule_packs.create_collection_from_template', {
    templateId: 'visual_assets',
    collection: 'custom_visuals',
    seedExample: true
  }, undefined, {
    authorization: true
  });
  assert.equal(created.output.multiCollection, true);
  assert.deepEqual(created.output.collections.map((collection) => collection.collection).sort(), [
    'custom_visuals_assets',
    'custom_visuals_bindings',
    'custom_visuals_event_bindings'
  ]);
  assert.equal(dataManager.hasCollection('custom_visuals_assets'), true);
  assert.equal(dataManager.hasCollection('custom_visuals_bindings'), true);
  assert.equal(dataManager.hasCollection('custom_visuals_event_bindings'), true);
  assert.equal(dataManager.getRecord('custom_visuals_assets', 'asset_mira_portrait').data.assetType, 'image');

  dataManager.close();
});
