// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ItemRegistry,
  SQLiteDataManager,
  createDefaultToolPluginManager
} from '../src/index.js';

test('item registry manages item categories with import/export', () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:', schemaDirectory: null });
  const registry = new ItemRegistry({ dataManager });

  const weapon = registry.upsertWeapon({
    id: 'longsword',
    name: '长剑',
    weaponType: 'sword',
    damage: { oneHanded: '1d8' },
    damageType: 'slashing',
    numericValues: {
      damageDiceSides: '8'
    }
  });
  const accessory = registry.upsertAccessory({
    id: 'warm_ring',
    name: '暖意戒指',
    accessoryType: 'ring',
    slot: 'ring',
    attunement: true
  });
  const mount = registry.upsertMount({
    id: 'warhorse',
    name: '战马',
    speed: { walk: 60 },
    carryingCapacity: { riders: 1 }
  });
  const special = registry.upsertSpecialItem({
    id: 'moon_key',
    name: '月相钥匙',
    specialType: 'quest_item',
    questRefs: ['silver_gate']
  });

  assert.deepEqual(weapon.data.numericValues, { damageDiceSides: 8 });
  assert.equal(accessory.data.slot, 'ring');
  assert.equal(mount.data.speed.walk, 60);
  assert.deepEqual(special.data.questRefs, ['silver_gate']);

  const listed = registry.listWeapons({ query: '长剑' });
  assert.equal(listed.records.length, 1);

  registry.patchWeapon('longsword', { rarity: 'uncommon' });
  assert.equal(registry.getWeapon('longsword').data.rarity, 'uncommon');

  const imported = registry.importDocument({
    format: 'json',
    text: JSON.stringify({
      items: [{ id: 'rope', name: '绳索', itemType: 'tool' }],
      equipment: [{ id: 'leather_armor', name: '皮甲', armorClass: { base: 11 } }],
      accessories: [{ id: 'silver_charm', name: '银护符', accessoryType: 'charm' }],
      weapons: [{ id: 'shortbow', name: '短弓', weaponType: 'bow' }],
      mounts: [{ id: 'pony', name: '矮种马', speed: { walk: 40 } }],
      specialItems: [{ id: 'sealed_letter', name: '密封信', specialType: 'quest_item' }]
    })
  });
  assert.equal(imported.counts.items, 1);
  assert.equal(imported.counts.equipment, 1);
  assert.equal(imported.counts.accessories, 1);
  assert.equal(imported.counts.weapons, 1);
  assert.equal(imported.counts.mounts, 1);
  assert.equal(imported.counts.specialItems, 1);

  const exported = registry.exportDocument({ format: 'json' });
  assert.equal(exported.payload.weapons.some((entry) => entry.id === 'shortbow'), true);
  assert.equal(exported.payload.specialItems.some((entry) => entry.id === 'moon_key'), true);

  assert.equal(registry.deleteSpecialItem('moon_key').deleted, true);
  dataManager.close();
});

test('item registry exposes item templates for creation and modding', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:', schemaDirectory: null });
  const registry = new ItemRegistry({ dataManager });

  const listed = registry.listTemplates({ includeFields: false, includeExamples: false });
  assert.deepEqual(listed.templates.map((template) => template.id).sort(), [
    'accessory',
    'equipment',
    'item',
    'mount',
    'special_item',
    'weapon'
  ]);

  const weaponTemplate = registry.getTemplate('arms');
  assert.equal(weaponTemplate.id, 'weapon');
  assert.equal(weaponTemplate.collection, 'weapon_registry');
  assert.equal(weaponTemplate.fields.some((field) => field.name === 'damage'), true);
  assert.equal(weaponTemplate.exampleRecord.id, 'longsword');

  const manager = createDefaultToolPluginManager({ dataManager, trace: false });
  const mountTemplate = await manager.executeTool('system.item_registry.get_template', {
    templateId: 'vehicles',
    includeFields: false,
    includeExamples: false
  });
  assert.equal(mountTemplate.output.id, 'mount');
  assert.equal(mountTemplate.output.fields, undefined);

  dataManager.close();
});

test('item registry tools require authorization and support agent quantification', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:', schemaDirectory: null });
  const chatProvider = {
    async generate() {
      return {
        content: JSON.stringify({
          field: 'damageBonus',
          mode: 'numeric',
          value: 3,
          confidence: 0.9,
          reason: 'Reference table maps rare flaming blade to +3 damage.',
          referencesUsed: ['weapon-bonus-scale']
        })
      };
    }
  };
  const manager = createDefaultToolPluginManager({ dataManager, chatProvider, trace: false });

  await assert.rejects(
    () => manager.executeTool('system.item_registry.upsert_weapon', {
      id: 'flame_blade',
      name: '焰刃'
    }),
    /requires explicit user authorization/
  );

  const written = await manager.executeTool('system.item_registry.upsert_weapon', {
    id: 'flame_blade',
    name: '焰刃',
    description: '一把罕见的燃焰长剑，命中时有明显额外火焰伤害。',
    quantificationDefinition: {
      prompt: '根据武器加值参考表量化物品效果。',
      numericFields: [
        { name: 'damageBonus', type: 'integer', min: 0, max: 10 }
      ],
      referenceDocuments: [
        {
          name: 'weapon-bonus-scale',
          fields: ['damageBonus'],
          text: '武器加值参考：普通+0，精良+1，罕见燃焰+3，神器+6。'
        }
      ]
    }
  }, undefined, {
    authorization: true,
    actor: 'agent'
  });

  assert.equal(written.output.id, 'flame_blade');
  assert.deepEqual(written.output.data.numericValues, { damageBonus: 3 });
  assert.equal(written.output.data.quantificationAudit.llm.used, true);

  dataManager.close();
});
