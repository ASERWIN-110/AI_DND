// @ts-nocheck
import YAML from 'yaml';
import { documentToCollections, parseStructuredDocument } from '../data/structured-document-importer.js';
import { SQLiteDataManager } from '../data/sqlite-data-manager.js';
import {
  RESOURCE_LIFECYCLE_FIELDS,
  filterRecordsByLifecycle,
  getVisibleRecordByLifecycle,
  resourceLifecycleFields
} from '../lifecycle/resource-lifecycle.js';
import { quantifyTextSmart } from '../data/text-quantifier.js';

export const ITEM_REGISTRY_COLLECTION = 'item_registry';
export const EQUIPMENT_REGISTRY_COLLECTION = 'equipment_registry';
export const ACCESSORY_REGISTRY_COLLECTION = 'accessory_registry';
export const WEAPON_REGISTRY_COLLECTION = 'weapon_registry';
export const MOUNT_REGISTRY_COLLECTION = 'mount_registry';
export const SPECIAL_ITEM_REGISTRY_COLLECTION = 'special_item_registry';

export const ITEM_NUMERIC_SETTING_FIELDS = [
  { name: 'numericValues', type: 'json', description: 'Final numeric settings such as bonus, damage, AC, speed, charges, value, weight, capacity, cooldown, or rarity score.' },
  { name: 'textSettings', type: 'json', description: 'Optional non-numeric special settings produced by text quantification rules.' },
  { name: 'quantificationDefinition', type: 'json', description: 'User-defined fuzzy-text quantification fields, references, and rules used to create numericValues.' },
  { name: 'quantificationSourceText', type: 'text', description: 'Natural-language source text used for the latest quantification.' },
  { name: 'quantificationAudit', type: 'json', description: 'Latest quantification decisions for review and debugging.' },
  { name: 'quantificationUpdatedAt', type: 'text', description: 'Latest quantification timestamp.' }
];

export const ITEM_COMMON_FIELDS = [
  { name: 'name', type: 'text', description: 'Display name.' },
  { name: 'category', type: 'text', description: 'User-defined item category or subtype.' },
  { name: 'rarity', type: 'text', description: 'common, uncommon, rare, epic, legendary, artifact, custom, etc.' },
  { name: 'tags', type: 'json', description: 'Search tags.' },
  { name: 'aliases', type: 'json', description: 'Alternative names.' },
  { name: 'description', type: 'text', description: 'Readable item description.' },
  { name: 'mechanicalEffect', type: 'text', description: 'Compact mechanical effect or prompt-ready rule.' },
  { name: 'lore', type: 'text', description: 'Optional story, origin, owner history, or flavor text.' },
  { name: 'value', type: 'json', description: 'Price, cost, sale value, or value object.' },
  { name: 'weight', type: 'json', description: 'Weight, encumbrance, bulk, or carrying object.' },
  { name: 'requirements', type: 'json', description: 'Use, attunement, proficiency, level, stat, faction, or story requirements.' },
  { name: 'grants', type: 'json', description: 'Granted statuses, skills, feats, actions, resources, bonuses, or permissions.' },
  { name: 'relatedSkillIds', type: 'json', description: 'Related skill ids.' },
  { name: 'relatedStatusIds', type: 'json', description: 'Related status ids.' },
  { name: 'relatedFeatIds', type: 'json', description: 'Related feat ids.' },
  { name: 'sourceRef', type: 'text', description: 'Rulebook, module, prompt, or homebrew reference.' },
  { name: 'status', type: 'text', description: 'active, draft, deprecated, hidden, destroyed, lost, etc.' },
  { name: 'metadata', type: 'json', description: 'Extra non-prompt registry metadata.' },
  ...RESOURCE_LIFECYCLE_FIELDS
];

export const ITEM_REGISTRY_FIELDS = buildItemFields([
  { name: 'itemType', type: 'text', description: 'generic, consumable, tool, container, material, currency, document, custom, etc.' },
  { name: 'stackRule', type: 'text', description: 'none, stack, charges, quantity, unique, custom.' },
  { name: 'uses', type: 'json', description: 'Uses, consumable behavior, recharge, or depletion rules.' },
  { name: 'charges', type: 'json', description: 'Charge count, recharge dice, or charge rules.' },
  { name: 'container', type: 'json', description: 'Container capacity, restrictions, or contents hint.' }
]);

export const EQUIPMENT_REGISTRY_FIELDS = buildItemFields([
  { name: 'equipmentType', type: 'text', description: 'armor, shield, clothing, toolset, kit, focus, instrument, custom, etc.' },
  { name: 'slot', type: 'text', description: 'body slot or worn/carried location.' },
  { name: 'armorType', type: 'text', description: 'light, medium, heavy, shield, natural, clothing, custom.' },
  { name: 'armorClass', type: 'json', description: 'AC formula, base AC, or defense profile.' },
  { name: 'defense', type: 'json', description: 'Defense bonuses, resistances, mitigation, or saving throw effects.' },
  { name: 'attunement', type: 'json', description: 'Attunement requirement or binding rules.' },
  { name: 'durability', type: 'json', description: 'Durability, condition, repair, breakage, or maintenance rules.' },
  { name: 'materials', type: 'json', description: 'Materials, crafting components, or quality markers.' }
]);

export const ACCESSORY_REGISTRY_FIELDS = buildItemFields([
  { name: 'accessoryType', type: 'text', description: 'ring, amulet, cloak, charm, belt, brooch, trinket, custom, etc.' },
  { name: 'slot', type: 'text', description: 'ring, neck, back, wrist, waist, charm, floating, custom.' },
  { name: 'attunement', type: 'json', description: 'Attunement, binding, curse, or ownership rules.' },
  { name: 'activation', type: 'json', description: 'Passive, action, reaction, command word, trigger, or ritual activation.' },
  { name: 'charges', type: 'json', description: 'Charge count, recharge, or use limits.' },
  { name: 'cooldown', type: 'json', description: 'Cooldown, once-per-scene, daily, or recovery rules.' },
  { name: 'drawbacks', type: 'json', description: 'Curses, drawbacks, costs, instability, or side effects.' }
]);

export const WEAPON_REGISTRY_FIELDS = buildItemFields([
  { name: 'weaponType', type: 'text', description: 'sword, axe, bow, firearm, staff, natural, improvised, custom, etc.' },
  { name: 'handedness', type: 'text', description: 'one-handed, two-handed, versatile, offhand, mounted, custom.' },
  { name: 'damage', type: 'json', description: 'Damage dice, flat damage, scaling, or damage formula.' },
  { name: 'damageType', type: 'text', description: 'slashing, piercing, bludgeoning, fire, psychic, custom, etc.' },
  { name: 'range', type: 'json', description: 'Melee reach, normal/long range, area, or targeting range.' },
  { name: 'properties', type: 'json', description: 'Finesse, light, heavy, thrown, reload, reach, magical, cursed, etc.' },
  { name: 'proficiency', type: 'json', description: 'Required or granted proficiency.' },
  { name: 'ammunition', type: 'json', description: 'Ammo type, magazine, reload, or consumption rules.' },
  { name: 'enchantment', type: 'json', description: 'Magic bonus, enchantment package, rune, spirit, or upgrade state.' },
  { name: 'durability', type: 'json', description: 'Durability, repair, breakage, jam, or maintenance rules.' }
]);

export const MOUNT_REGISTRY_FIELDS = buildItemFields([
  { name: 'mountType', type: 'text', description: 'horse, beast, vehicle, construct, flying, aquatic, magical, custom, etc.' },
  { name: 'creatureType', type: 'text', description: 'beast, dragon, construct, undead, vehicle, custom, etc.' },
  { name: 'size', type: 'text', description: 'tiny, small, medium, large, huge, gargantuan, custom.' },
  { name: 'speed', type: 'json', description: 'Walk, fly, swim, climb, burrow, or travel speed.' },
  { name: 'carryingCapacity', type: 'json', description: 'Rider, cargo, pull, tow, inventory, or encumbrance capacity.' },
  { name: 'temperament', type: 'text', description: 'Calm, loyal, skittish, aggressive, intelligent, custom.' },
  { name: 'training', type: 'json', description: 'Training, commands, proficiencies, tricks, or obedience rules.' },
  { name: 'upkeep', type: 'json', description: 'Feed, fuel, stabling, maintenance, wages, or repair costs.' },
  { name: 'combatRole', type: 'json', description: 'Combat actions, attack profile, defenses, morale, or rider interactions.' },
  { name: 'equipmentSlots', type: 'json', description: 'Saddle, barding, cargo, harness, weapon mount, or upgrade slots.' }
]);

export const SPECIAL_ITEM_REGISTRY_FIELDS = buildItemFields([
  { name: 'specialType', type: 'text', description: 'artifact, relic, quest item, key item, cursed object, plot device, custom, etc.' },
  { name: 'activation', type: 'json', description: 'Activation, trigger, ritual, command, condition, or story gate.' },
  { name: 'charges', type: 'json', description: 'Charges, fuel, soul count, favor, instability, or resource counters.' },
  { name: 'cooldown', type: 'json', description: 'Cooldown, once-per-scene, daily, lunar, sacrifice, or recharge rules.' },
  { name: 'sideEffects', type: 'json', description: 'Side effects, curses, corruption, attention, debt, or instability.' },
  { name: 'questRefs', type: 'json', description: 'Related quests, scenes, factions, locations, or NPC ids.' },
  { name: 'boundTo', type: 'json', description: 'Owner, bloodline, faction, pact, attuned user, or bearer restrictions.' },
  { name: 'sentience', type: 'json', description: 'Sentience, personality, goals, communication, or ego rules.' },
  { name: 'lifecycle', type: 'json', description: 'Dormant, awakened, broken, sealed, evolving, consumed, or destroyed states.' }
]);

export const ITEM_KIND_TEMPLATES = {
  item: createItemTemplate({
    id: 'item',
    title: 'Generic Item Template',
    description: 'Registered template for ordinary items, consumables, tools, containers, materials, and documents.',
    collection: ITEM_REGISTRY_COLLECTION,
    recordKey: 'items',
    aliases: ['items', 'item_registry', 'goods', 'objects'],
    prefix: 'item',
    fields: ITEM_REGISTRY_FIELDS,
    exampleRecord: {
      id: 'healing_potion',
      name: '治疗药剂',
      category: 'consumable',
      itemType: 'potion',
      rarity: 'common',
      stackRule: 'quantity',
      uses: { consumeOnUse: true },
      mechanicalEffect: 'Consume to restore hit points.',
      numericValues: { healingDiceCount: 2, healingDiceSides: 4, healingBonus: 2 }
    }
  }),
  equipment: createItemTemplate({
    id: 'equipment',
    title: 'Equipment Template',
    description: 'Registered template for armor, shields, clothing, kits, focuses, instruments, and worn/carried equipment.',
    collection: EQUIPMENT_REGISTRY_COLLECTION,
    recordKey: 'equipment',
    aliases: ['equipment_registry', 'gear', 'armor', 'armour', 'shields', 'kits'],
    prefix: 'equipment',
    fields: EQUIPMENT_REGISTRY_FIELDS,
    exampleRecord: {
      id: 'chain_mail',
      name: '链甲',
      category: 'armor',
      equipmentType: 'armor',
      slot: 'body',
      armorType: 'heavy',
      armorClass: { base: 16 },
      requirements: { strength: 13 },
      numericValues: { armorClass: 16, strengthRequirement: 13 }
    }
  }),
  accessory: createItemTemplate({
    id: 'accessory',
    title: 'Accessory Template',
    description: 'Registered template for rings, amulets, cloaks, charms, belts, brooches, and other accessories.',
    collection: ACCESSORY_REGISTRY_COLLECTION,
    recordKey: 'accessories',
    aliases: ['accessories', 'accessory_registry', 'jewelry', 'jewellery', 'trinkets', 'ornaments'],
    prefix: 'accessory',
    fields: ACCESSORY_REGISTRY_FIELDS,
    exampleRecord: {
      id: 'ring_of_warmth',
      name: '暖意戒指',
      category: 'ring',
      accessoryType: 'ring',
      slot: 'ring',
      attunement: true,
      grants: ['cold_resistance'],
      numericValues: { resistanceCold: 1 }
    }
  }),
  weapon: createItemTemplate({
    id: 'weapon',
    title: 'Weapon Template',
    description: 'Registered template for melee, ranged, thrown, natural, improvised, magical, and custom weapons.',
    collection: WEAPON_REGISTRY_COLLECTION,
    recordKey: 'weapons',
    aliases: ['weapons', 'weapon_registry', 'arms'],
    prefix: 'weapon',
    fields: WEAPON_REGISTRY_FIELDS,
    exampleRecord: {
      id: 'longsword',
      name: '长剑',
      category: 'martial',
      weaponType: 'sword',
      handedness: 'versatile',
      damage: { oneHanded: '1d8', twoHanded: '1d10' },
      damageType: 'slashing',
      properties: ['versatile'],
      numericValues: { damageDiceSides: 8, versatileDiceSides: 10 }
    }
  }),
  mount: createItemTemplate({
    id: 'mount',
    title: 'Mount Template',
    description: 'Registered template for mounts, pack animals, vehicles, constructs, magical rides, and travel companions.',
    collection: MOUNT_REGISTRY_COLLECTION,
    recordKey: 'mounts',
    aliases: ['mounts', 'mount_registry', 'steeds', 'vehicles', 'riding_animals'],
    prefix: 'mount',
    fields: MOUNT_REGISTRY_FIELDS,
    exampleRecord: {
      id: 'warhorse',
      name: '战马',
      category: 'riding',
      mountType: 'horse',
      creatureType: 'beast',
      size: 'large',
      speed: { walk: 60 },
      carryingCapacity: { riders: 1, cargoLb: 540 },
      temperament: 'trained',
      numericValues: { walkSpeed: 60, cargoLb: 540 }
    }
  }),
  special_item: createItemTemplate({
    id: 'special_item',
    title: 'Special Item Template',
    description: 'Registered template for artifacts, relics, quest items, cursed objects, keys, plot devices, and unique props.',
    collection: SPECIAL_ITEM_REGISTRY_COLLECTION,
    recordKey: 'specialItems',
    aliases: ['special_items', 'special_item_registry', 'artifacts', 'relics', 'quest_items', 'key_items'],
    prefix: 'special_item',
    fields: SPECIAL_ITEM_REGISTRY_FIELDS,
    exampleRecord: {
      id: 'moon_key',
      name: '月相钥匙',
      category: 'quest_item',
      specialType: 'key item',
      rarity: 'unique',
      activation: { condition: 'full_moon', action: 'turn_in_silver_gate' },
      questRefs: ['silver_gate'],
      lifecycle: { state: 'dormant' },
      textSettings: { clue: 'Only opens the gate under moonlight.' }
    }
  })
};

const KIND_CONFIG = Object.fromEntries(Object.entries(ITEM_KIND_TEMPLATES).map(([kind, template]) => [
  kind,
  {
    collection: template.collection,
    fields: template.fields,
    recordKey: template.recordKey,
    aliases: template.aliases,
    prefix: template.prefix
  }
]));

export class ItemRegistry {
  constructor({
    dataManager = new SQLiteDataManager(),
    appDatabase,
    now
  } = {}) {
    this.dataManager = dataManager;
    this.appDatabase = appDatabase;
    this.now = now || (() => new Date().toISOString());
    this.ensureRegistry();
  }

  ensureRegistry() {
    for (const [kind, config] of Object.entries(KIND_CONFIG)) {
      this.dataManager.ensureCollection(config.collection);
      this.dataManager.alterFields(config.collection, {
        add: config.fields,
        reason: `itemRegistry:${kind}`
      });
    }
    return this.describe();
  }

  describe() {
    return Object.fromEntries(Object.entries(KIND_CONFIG).map(([kind, config]) => [
      kind,
      this.dataManager.describeCollection(config.collection)
    ]));
  }

  listTemplates(input = {}) {
    return listItemTemplates(input);
  }

  getTemplate(id, options = {}) {
    return getItemTemplate(id, options);
  }

  upsertItem(item, options = {}) {
    return this.upsertRecord('item', item, options);
  }

  async upsertItemAsync(item, options = {}) {
    return this.upsertRecordAsync('item', item, options);
  }

  patchItem(id, patch, options = {}) {
    return this.patchRecord('item', id, patch, options);
  }

  async patchItemAsync(id, patch, options = {}) {
    return this.patchRecordAsync('item', id, patch, options);
  }

  getItem(id) {
    return this.getRecord('item', id);
  }

  deleteItem(id) {
    return this.deleteRecord('item', id);
  }

  listItems(input = {}) {
    return this.listRecords('item', input);
  }

  upsertEquipment(equipment, options = {}) {
    return this.upsertRecord('equipment', equipment, options);
  }

  async upsertEquipmentAsync(equipment, options = {}) {
    return this.upsertRecordAsync('equipment', equipment, options);
  }

  patchEquipment(id, patch, options = {}) {
    return this.patchRecord('equipment', id, patch, options);
  }

  async patchEquipmentAsync(id, patch, options = {}) {
    return this.patchRecordAsync('equipment', id, patch, options);
  }

  getEquipment(id) {
    return this.getRecord('equipment', id);
  }

  deleteEquipment(id) {
    return this.deleteRecord('equipment', id);
  }

  listEquipment(input = {}) {
    return this.listRecords('equipment', input);
  }

  upsertAccessory(accessory, options = {}) {
    return this.upsertRecord('accessory', accessory, options);
  }

  async upsertAccessoryAsync(accessory, options = {}) {
    return this.upsertRecordAsync('accessory', accessory, options);
  }

  patchAccessory(id, patch, options = {}) {
    return this.patchRecord('accessory', id, patch, options);
  }

  async patchAccessoryAsync(id, patch, options = {}) {
    return this.patchRecordAsync('accessory', id, patch, options);
  }

  getAccessory(id) {
    return this.getRecord('accessory', id);
  }

  deleteAccessory(id) {
    return this.deleteRecord('accessory', id);
  }

  listAccessories(input = {}) {
    return this.listRecords('accessory', input);
  }

  upsertWeapon(weapon, options = {}) {
    return this.upsertRecord('weapon', weapon, options);
  }

  async upsertWeaponAsync(weapon, options = {}) {
    return this.upsertRecordAsync('weapon', weapon, options);
  }

  patchWeapon(id, patch, options = {}) {
    return this.patchRecord('weapon', id, patch, options);
  }

  async patchWeaponAsync(id, patch, options = {}) {
    return this.patchRecordAsync('weapon', id, patch, options);
  }

  getWeapon(id) {
    return this.getRecord('weapon', id);
  }

  deleteWeapon(id) {
    return this.deleteRecord('weapon', id);
  }

  listWeapons(input = {}) {
    return this.listRecords('weapon', input);
  }

  upsertMount(mount, options = {}) {
    return this.upsertRecord('mount', mount, options);
  }

  async upsertMountAsync(mount, options = {}) {
    return this.upsertRecordAsync('mount', mount, options);
  }

  patchMount(id, patch, options = {}) {
    return this.patchRecord('mount', id, patch, options);
  }

  async patchMountAsync(id, patch, options = {}) {
    return this.patchRecordAsync('mount', id, patch, options);
  }

  getMount(id) {
    return this.getRecord('mount', id);
  }

  deleteMount(id) {
    return this.deleteRecord('mount', id);
  }

  listMounts(input = {}) {
    return this.listRecords('mount', input);
  }

  upsertSpecialItem(item, options = {}) {
    return this.upsertRecord('special_item', item, options);
  }

  async upsertSpecialItemAsync(item, options = {}) {
    return this.upsertRecordAsync('special_item', item, options);
  }

  patchSpecialItem(id, patch, options = {}) {
    return this.patchRecord('special_item', id, patch, options);
  }

  async patchSpecialItemAsync(id, patch, options = {}) {
    return this.patchRecordAsync('special_item', id, patch, options);
  }

  getSpecialItem(id) {
    return this.getRecord('special_item', id);
  }

  deleteSpecialItem(id) {
    return this.deleteRecord('special_item', id);
  }

  listSpecialItems(input = {}) {
    return this.listRecords('special_item', input);
  }

  upsertRecord(kind, input, options = {}) {
    const normalizedKind = normalizeItemKind(kind);
    const config = KIND_CONFIG[normalizedKind];
    const prepared = applyItemQuantification(normalizedKind, input, {
      context: options.context
    });
    const normalized = normalizeItemRecord(normalizedKind, prepared, { now: this.now });
    return this.dataManager.upsertRecord(config.collection, normalized, { id: normalized.id });
  }

  async upsertRecordAsync(kind, input, options = {}) {
    const normalizedKind = normalizeItemKind(kind);
    const config = KIND_CONFIG[normalizedKind];
    const prepared = await applyItemQuantificationAsync(normalizedKind, input, {
      now: this.now,
      context: options.context,
      chatProvider: options.chatProvider
    });
    const normalized = normalizeItemRecord(normalizedKind, prepared, { now: this.now });
    return this.dataManager.upsertRecord(config.collection, normalized, { id: normalized.id });
  }

  patchRecord(kind, id, patch, options = {}) {
    const normalizedKind = normalizeItemKind(kind);
    const current = this.getRecord(normalizedKind, id);
    const prepared = applyItemQuantification(normalizedKind, {
      ...current.data,
      ...patch,
      id: current.id,
      lifecycleCanonicalId: current.data.lifecycleCanonicalId || id
    }, {
      context: options.context
    });
    const normalized = normalizeItemRecord(normalizedKind, prepared, { now: this.now });
    return this.dataManager.upsertRecord(KIND_CONFIG[normalizedKind].collection, normalized, { id: current.id });
  }

  async patchRecordAsync(kind, id, patch, options = {}) {
    const normalizedKind = normalizeItemKind(kind);
    const current = this.getRecord(normalizedKind, id);
    const prepared = await applyItemQuantificationAsync(normalizedKind, {
      ...current.data,
      ...patch,
      id: current.id,
      lifecycleCanonicalId: current.data.lifecycleCanonicalId || id
    }, {
      now: this.now,
      context: options.context,
      chatProvider: options.chatProvider
    });
    const normalized = normalizeItemRecord(normalizedKind, prepared, { now: this.now });
    return this.dataManager.upsertRecord(KIND_CONFIG[normalizedKind].collection, normalized, { id: current.id });
  }

  getRecord(kind, id) {
    const normalizedKind = normalizeItemKind(kind);
    return getVisibleRecordByLifecycle(this.dataManager, KIND_CONFIG[normalizedKind].collection, id, {}, { appDatabase: this.appDatabase })
      || this.dataManager.getRecord(KIND_CONFIG[normalizedKind].collection, id);
  }

  deleteRecord(kind, id) {
    const normalizedKind = normalizeItemKind(kind);
    return this.dataManager.deleteRecord(KIND_CONFIG[normalizedKind].collection, id);
  }

  listRecords(kind, input = {}) {
    const {
    filter = {},
    tags = [],
    query = '',
    sort = [{ field: 'name', direction: 'asc' }],
    limit = 100,
    offset = 0
    } = input;
    const normalizedKind = normalizeItemKind(kind);
    const result = filterRecordsByLifecycle(this.dataManager.queryRecords(KIND_CONFIG[normalizedKind].collection, {
      filter,
      sort,
      limit,
      offset
    }), input, { appDatabase: this.appDatabase });
    const requiredTags = normalizeStringArray(tags).map(normalizeSearchText);
    const normalizedQuery = normalizeSearchText(query);
    const records = result.records.filter((record) => matchesItemSearch(record, {
      requiredTags,
      normalizedQuery
    }));
    return {
      ...result,
      kind: normalizedKind,
      records
    };
  }

  importDocument(input = {}, options = {}) {
    const parsed = parseStructuredDocument(input);
    const groups = documentToCollections({
      data: parsed.data,
      collection: input.collection,
      collectionMap: input.collectionMap || defaultCollectionMap(),
      idField: input.idField || 'id'
    });
    const kinds = input.kind ? [normalizeItemKind(input.kind)] : Object.keys(KIND_CONFIG);
    const imported = {};
    const quantificationDefaults = itemImportQuantificationDefaults(input);
    for (const kind of kinds) {
      const selected = selectItemRecords(groups, kind, input.collection);
      imported[KIND_CONFIG[kind].recordKey] = selected.map((record) => this.upsertRecord(kind, {
        ...quantificationDefaults,
        ...lifecycleImportDefaults(input),
        ...record,
        importSource: input.source || 'document-import'
      }, options));
    }
    const counts = Object.fromEntries(Object.entries(imported).map(([key, records]) => [key, records.length]));
    const ids = Object.fromEntries(Object.entries(imported).map(([key, records]) => [key, records.map((record) => record.id)]));
    return {
      format: parsed.format,
      counts,
      ids,
      records: imported
    };
  }

  async importDocumentAsync(input = {}, options = {}) {
    const parsed = parseStructuredDocument(input);
    const groups = documentToCollections({
      data: parsed.data,
      collection: input.collection,
      collectionMap: input.collectionMap || defaultCollectionMap(),
      idField: input.idField || 'id'
    });
    const kinds = input.kind ? [normalizeItemKind(input.kind)] : Object.keys(KIND_CONFIG);
    const imported = {};
    const quantificationDefaults = itemImportQuantificationDefaults(input);
    for (const kind of kinds) {
      const selected = selectItemRecords(groups, kind, input.collection);
      imported[KIND_CONFIG[kind].recordKey] = [];
      for (const record of selected) {
        imported[KIND_CONFIG[kind].recordKey].push(await this.upsertRecordAsync(kind, {
          ...quantificationDefaults,
          ...lifecycleImportDefaults(input),
          ...record,
          importSource: input.source || 'document-import'
        }, options));
      }
    }
    const counts = Object.fromEntries(Object.entries(imported).map(([key, records]) => [key, records.length]));
    const ids = Object.fromEntries(Object.entries(imported).map(([key, records]) => [key, records.map((record) => record.id)]));
    return {
      format: parsed.format,
      counts,
      ids,
      records: imported
    };
  }

  exportDocument({
    format = 'json',
    kind,
    filter = {},
    tags = [],
    query = '',
    limit = 500,
    offset = 0
  } = {}) {
    const kinds = kind ? [normalizeItemKind(kind)] : Object.keys(KIND_CONFIG);
    const payload = {};
    for (const currentKind of kinds) {
      const listed = this.listRecords(currentKind, { filter, tags, query, limit, offset });
      payload[KIND_CONFIG[currentKind].recordKey] = listed.records.map((record) => ({
        id: record.id,
        ...record.data
      }));
    }
    const normalizedFormat = String(format || 'json').toLowerCase();
    if (normalizedFormat === 'json') {
      return {
        format: 'json',
        text: `${JSON.stringify(payload, null, 2)}\n`,
        payload
      };
    }
    if (normalizedFormat === 'yaml' || normalizedFormat === 'yml') {
      return {
        format: 'yaml',
        text: YAML.stringify(payload),
        payload
      };
    }
    throw validationError('export format must be json or yaml');
  }
}

export function normalizeItemRecord(kind, input = {}, { now = () => new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError(`${kind} must be a plain object`);
  }
  const normalizedKind = normalizeItemKind(kind);
  const name = normalizeOptionalText(input.name);
  if (!name) throw validationError(`${normalizedKind}.name is required`);
  const id = normalizeItemId(input.id || input[`${normalizedKind}Id`] || input.specialItemId || input.itemId || name, KIND_CONFIG[normalizedKind].prefix);
  const base = {
    id,
    name,
    category: normalizeOptionalText(input.category || input.type || 'custom'),
    rarity: normalizeOptionalText(input.rarity || input.tier || 'common'),
    tags: normalizeStringArray(input.tags),
    aliases: normalizeStringArray(input.aliases),
    description: normalizeOptionalText(input.description || input.summary || input.text),
    mechanicalEffect: normalizeOptionalText(input.mechanicalEffect || input.effect || input.rule || input.rulesText),
    lore: normalizeOptionalText(input.lore || input.flavor || input.backstory),
    value: normalizeJsonLike(input.value ?? input.price ?? input.cost),
    weight: normalizeJsonLike(input.weight ?? input.bulk ?? input.encumbrance),
    requirements: normalizeArrayOrObject(input.requirements || input.prerequisites || input.requires),
    grants: normalizeArrayOrObject(input.grants || input.bonuses || input.unlocks),
    relatedSkillIds: normalizeStringArray(input.relatedSkillIds || input.skillRefs || input.skills),
    relatedStatusIds: normalizeStringArray(input.relatedStatusIds || input.statusRefs || input.statuses),
    relatedFeatIds: normalizeStringArray(input.relatedFeatIds || input.featRefs || input.feats),
    sourceRef: normalizeOptionalText(input.sourceRef || input.source || input.bookRef),
    status: normalizeOptionalText(input.status || 'active'),
    metadata: normalizeMetadata(input),
    numericValues: normalizeNumericValues(input.numericValues || input.values || input.numericSettings || input.settingValues),
    textSettings: normalizePlainObject(input.textSettings || input.specialTextSettings),
    quantificationDefinition: normalizePlainObject(input.quantificationDefinition || input.numericDefinition || input.definition),
    quantificationSourceText: normalizeOptionalText(input.quantificationSourceText || input.numericSourceText || input.quantificationText),
    quantificationAudit: normalizePlainObject(input.quantificationAudit || input.numericQuantification),
    quantificationUpdatedAt: normalizeOptionalText(input.quantificationUpdatedAt),
    ...resourceLifecycleFields(input),
    registryUpdatedAt: now()
  };

  if (normalizedKind === 'item') {
    return {
      ...base,
      itemType: normalizeOptionalText(input.itemType || input.kind || 'generic'),
      stackRule: normalizeOptionalText(input.stackRule || input.stacking || (input.stackable ? 'stack' : 'none')),
      uses: normalizeJsonLike(input.uses || input.useRules || input.consumable),
      charges: normalizeJsonLike(input.charges || input.chargeRules),
      container: normalizeJsonLike(input.container || input.contents || input.capacity)
    };
  }

  if (normalizedKind === 'equipment') {
    return {
      ...base,
      equipmentType: normalizeOptionalText(input.equipmentType || input.kind || input.armorType || 'gear'),
      slot: normalizeOptionalText(input.slot || input.bodySlot || input.equipSlot),
      armorType: normalizeOptionalText(input.armorType || input.armor || ''),
      armorClass: normalizeJsonLike(input.armorClass || input.ac),
      defense: normalizeJsonLike(input.defense || input.defenses || input.resistances),
      attunement: normalizeJsonLike(input.attunement ?? input.requiresAttunement),
      durability: normalizeJsonLike(input.durability || input.condition || input.repair),
      materials: normalizeArrayOrObject(input.materials || input.components)
    };
  }

  if (normalizedKind === 'accessory') {
    return {
      ...base,
      accessoryType: normalizeOptionalText(input.accessoryType || input.kind || input.jewelryType || 'trinket'),
      slot: normalizeOptionalText(input.slot || input.bodySlot || input.equipSlot),
      attunement: normalizeJsonLike(input.attunement ?? input.requiresAttunement),
      activation: normalizeJsonLike(input.activation || input.trigger || input.action),
      charges: normalizeJsonLike(input.charges || input.chargeRules),
      cooldown: normalizeJsonLike(input.cooldown || input.recharge),
      drawbacks: normalizeArrayOrObject(input.drawbacks || input.curses || input.sideEffects)
    };
  }

  if (normalizedKind === 'weapon') {
    return {
      ...base,
      weaponType: normalizeOptionalText(input.weaponType || input.kind || 'weapon'),
      handedness: normalizeOptionalText(input.handedness || input.hands || input.grip),
      damage: normalizeJsonLike(input.damage || input.damageDice || input.damageFormula),
      damageType: normalizeOptionalText(input.damageType || input.element || ''),
      range: normalizeJsonLike(input.range || input.reach || input.distance),
      properties: normalizeArrayOrObject(input.properties || input.traits),
      proficiency: normalizeJsonLike(input.proficiency || input.proficiencies),
      ammunition: normalizeJsonLike(input.ammunition || input.ammo || input.reload),
      enchantment: normalizeJsonLike(input.enchantment || input.magic || input.upgrades),
      durability: normalizeJsonLike(input.durability || input.condition || input.repair)
    };
  }

  if (normalizedKind === 'mount') {
    return {
      ...base,
      mountType: normalizeOptionalText(input.mountType || input.kind || input.vehicleType || 'mount'),
      creatureType: normalizeOptionalText(input.creatureType || input.species || ''),
      size: normalizeOptionalText(input.size || ''),
      speed: normalizeJsonLike(input.speed || input.speeds || input.movement),
      carryingCapacity: normalizeJsonLike(input.carryingCapacity || input.capacity || input.cargo),
      temperament: normalizeOptionalText(input.temperament || input.disposition || ''),
      training: normalizeJsonLike(input.training || input.commands || input.tricks),
      upkeep: normalizeJsonLike(input.upkeep || input.maintenance || input.feed || input.fuel),
      combatRole: normalizeJsonLike(input.combatRole || input.combat || input.actions),
      equipmentSlots: normalizeJsonLike(input.equipmentSlots || input.slots || input.upgradeSlots)
    };
  }

  return {
    ...base,
    specialType: normalizeOptionalText(input.specialType || input.kind || input.artifactType || 'special'),
    activation: normalizeJsonLike(input.activation || input.trigger || input.action || input.ritual),
    charges: normalizeJsonLike(input.charges || input.chargeRules || input.fuel),
    cooldown: normalizeJsonLike(input.cooldown || input.recharge),
    sideEffects: normalizeArrayOrObject(input.sideEffects || input.drawbacks || input.curses),
    questRefs: normalizeStringArray(input.questRefs || input.quests || input.sceneRefs),
    boundTo: normalizeJsonLike(input.boundTo || input.owner || input.bearer),
    sentience: normalizeJsonLike(input.sentience || input.personality || input.ego),
    lifecycle: normalizeJsonLike(input.lifecycle || input.state || input.states)
  };
}

export function listItemTemplates({
  query = '',
  includeFields = true,
  includeExamples = true
} = {}) {
  const normalizedQuery = normalizeSearchText(query);
  const templates = Object.values(ITEM_KIND_TEMPLATES)
    .filter((template) => {
      if (!normalizedQuery) return true;
      return normalizeSearchText([
        template.id,
        template.title,
        template.description,
        template.recordKey,
        template.collection,
        ...(template.aliases || []),
        ...(template.tags || [])
      ].filter(Boolean).join(' ')).includes(normalizedQuery);
    })
    .map((template) => projectItemTemplate(template, { includeFields, includeExamples }));
  return {
    count: templates.length,
    templates
  };
}

export function getItemTemplate(id, {
  includeFields = true,
  includeExamples = true
} = {}) {
  const template = resolveItemTemplate(id);
  if (!template) throw validationError(`Item template not found: ${id}`);
  return projectItemTemplate(template, { includeFields, includeExamples });
}

function buildItemFields(specificFields = []) {
  return [
    ...cloneJson(ITEM_COMMON_FIELDS),
    ...cloneJson(specificFields),
    ...cloneJson(ITEM_NUMERIC_SETTING_FIELDS),
    { name: 'registryUpdatedAt', type: 'text', description: 'Latest registry update timestamp.' }
  ];
}

function createItemTemplate({
  id,
  title,
  description,
  collection,
  recordKey,
  aliases = [],
  prefix = '',
  fields = [],
  exampleRecord = {},
  quantificationTemplate,
  tags = []
}) {
  return {
    id,
    title,
    description,
    registered: true,
    templateOnly: false,
    collection,
    recordKey,
    aliases,
    prefix,
    tags: [...new Set(['items', id, 'registered', ...tags])],
    fields: cloneJson(fields),
    fieldNames: fields.map((field) => field.name),
    exampleRecord: cloneJson(exampleRecord),
    quantificationTemplate: cloneJson(quantificationTemplate || defaultItemQuantificationTemplate(id)),
    notes: ['This template is backed by an item registry collection.']
  };
}

function defaultItemQuantificationTemplate(id) {
  return {
    prompt: `Quantify ${id} item mechanics from fuzzy text using user-provided item reference material first.`,
    numericFields: [
      {
        name: 'powerScore',
        type: 'integer',
        min: 0,
        max: 10,
        defaultValue: 0,
        description: 'Optional generic item power or impact score for debugging templates.'
      },
      {
        name: 'valueScore',
        type: 'integer',
        min: 0,
        max: 10,
        defaultValue: 0,
        description: 'Optional relative cost, rarity, or economic value score.'
      }
    ],
    referenceDocuments: []
  };
}

function matchesItemSearch(record, { requiredTags, normalizedQuery }) {
  const data = record.data || {};
  if (requiredTags.length > 0) {
    const tags = new Set(normalizeStringArray(data.tags).map(normalizeSearchText));
    if (!requiredTags.every((tag) => tags.has(tag))) return false;
  }
  if (!normalizedQuery) return true;
  return normalizeSearchText(JSON.stringify({
    id: record.id,
    ...data
  })).includes(normalizedQuery);
}

function selectItemRecords(groups, kind, preferredCollection) {
  const config = KIND_CONFIG[kind];
  const candidates = [preferredCollection, config.collection, ...config.aliases].filter(Boolean);
  const selected = candidates
    .map((collection) => groups.find((group) => group.collection === collection))
    .find(Boolean);
  return (selected?.records || []).filter((record) => record && typeof record === 'object');
}

function defaultCollectionMap() {
  return Object.fromEntries(Object.values(KIND_CONFIG).flatMap((config) => (
    [config.recordKey, config.collection, ...config.aliases].map((alias) => [alias, config.collection])
  )));
}

function itemImportQuantificationDefaults(input = {}) {
  const keys = [
    'quantify',
    'quantifyNumeric',
    'autoQuantify',
    'useLlm',
    'preferLlm',
    'requireLlm',
    'allowNewFields',
    'maxNewFields',
    'quantificationDefinition',
    'numericDefinition',
    'definition',
    'referenceText',
    'referenceDocuments',
    'referenceDocs',
    'referenceFiles',
    'referenceFilePaths',
    'allowReferenceFilePaths',
    'cwd',
    'temperature',
    'maxTokens',
    'newFieldsMaxTokens'
  ];
  return Object.fromEntries(keys
    .filter((key) => input[key] !== undefined)
    .map((key) => [key, input[key]]));
}

function applyItemQuantification(kind, input = {}, {
  context = {}
} = {}) {
  const definition = selectQuantificationDefinition(input);
  const explicit = input.quantify === true
    || input.quantifyNumeric === true
    || input.autoQuantify === true
    || input.quantification?.enabled === true;
  const agentCreated = isAgentAuthored(input, context);
  const hasDirectNumericValues = hasPlainObject(input.numericValues)
    || hasPlainObject(input.values)
    || hasPlainObject(input.numericSettings)
    || hasPlainObject(input.settingValues);
  const shouldQuantify = explicit || (agentCreated && definition && !hasDirectNumericValues);

  if (!shouldQuantify) return input;
  throw validationError(`${kind} item quantification must use the unified async quantification path. Use system.item_registry.* tools or ItemRegistry *Async methods.`);
}

async function applyItemQuantificationAsync(kind, input = {}, {
  now = () => new Date().toISOString(),
  context = {},
  chatProvider
} = {}) {
  const definition = selectQuantificationDefinition(input);
  const explicit = input.quantify === true
    || input.quantifyNumeric === true
    || input.autoQuantify === true
    || input.quantification?.enabled === true;
  const agentCreated = isAgentAuthored(input, context);
  const hasDirectNumericValues = hasPlainObject(input.numericValues)
    || hasPlainObject(input.values)
    || hasPlainObject(input.numericSettings)
    || hasPlainObject(input.settingValues);
  const shouldQuantify = explicit || (agentCreated && definition && !hasDirectNumericValues);

  if (!shouldQuantify) return input;
  if (!definition) {
    throw validationError('quantificationDefinition, numericDefinition, or definition is required when quantifyNumeric is true');
  }

  const sourceText = selectQuantificationSourceText(input);
  if (!sourceText) {
    throw validationError('quantificationSourceText, numericSourceText, quantificationText, text, description, or mechanicalEffect is required for item quantification');
  }

  const quantified = await quantifyTextSmart({
    text: sourceText,
    definition,
    values: normalizePlainObject(input.quantificationValues || input.providedValues || {}),
    useLlm: input.useLlm ?? input.preferLlm ?? Boolean(agentCreated && chatProvider),
    preferLlm: input.preferLlm,
    requireLlm: input.requireLlm,
    allowNewFields: input.allowNewFields ?? definition.allowNewFields,
    maxNewFields: input.maxNewFields ?? definition.maxNewFields,
    referenceText: input.referenceText,
    referenceDocuments: input.referenceDocuments || input.referenceDocs,
    referenceFiles: input.referenceFiles || input.referenceFilePaths,
    allowReferenceFilePaths: Boolean(input.allowReferenceFilePaths),
    cwd: input.cwd,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    newFieldsMaxTokens: input.newFieldsMaxTokens,
    storeRawText: false,
    storeAudit: false
  }, { chatProvider });
  const numericValues = {
    ...normalizeNumericValues(input.numericValues || input.values || input.numericSettings || input.settingValues),
    ...extractNumericQuantifiedValues(quantified.values)
  };
  const textSettings = {
    ...normalizePlainObject(input.textSettings || input.specialTextSettings),
    ...extractTextQuantifiedValues(quantified.values)
  };

  return {
    ...input,
    numericValues,
    textSettings,
    quantificationDefinition: definition,
    quantificationSourceText: sourceText,
    quantificationAudit: {
      kind,
      trigger: explicit ? 'explicit' : 'agent_authored',
      prompt: quantified.prompt,
      definitionVersion: quantified.definitionVersion,
      values: quantified.values,
      numericValues,
      textSettings,
      decisions: quantified.decisions,
      llm: quantified.llm
        ? {
          used: Boolean(quantified.llm.used),
          calls: (quantified.llm.calls || []).map((call) => ({
            field: call.field,
            content: call.content
          }))
        }
        : { used: false }
    },
    quantificationUpdatedAt: now()
  };
}

function selectQuantificationDefinition(input = {}) {
  if (hasPlainObject(input.quantificationDefinition)) return input.quantificationDefinition;
  if (hasPlainObject(input.numericDefinition)) return input.numericDefinition;
  if (hasPlainObject(input.definition)) return input.definition;
  if (hasPlainObject(input.quantification?.definition)) return input.quantification.definition;
  return undefined;
}

function selectQuantificationSourceText(input = {}) {
  return normalizeOptionalText(
    input.quantificationSourceText
    || input.numericSourceText
    || input.quantificationText
    || input.text
    || [input.description || input.summary, input.mechanicalEffect || input.effect || input.rule || input.rulesText, input.lore || input.flavor]
      .filter(Boolean)
      .join('\n')
  );
}

function extractNumericQuantifiedValues(values = {}) {
  const output = {};
  for (const [field, value] of Object.entries(values || {})) {
    if (value === undefined || value === null || value === '') continue;
    const number = Number(value);
    if (!Number.isFinite(number)) continue;
    output[field] = number;
  }
  return output;
}

function extractTextQuantifiedValues(values = {}) {
  const output = {};
  for (const [field, value] of Object.entries(values || {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Number.isFinite(Number(value))) continue;
    output[field] = value;
  }
  return output;
}

function resolveItemTemplate(id) {
  const normalized = normalizeSearchText(id);
  return Object.values(ITEM_KIND_TEMPLATES).find((template) => (
    normalizeSearchText(template.id) === normalized
    || normalizeSearchText(template.recordKey) === normalized
    || normalizeSearchText(template.collection) === normalized
    || (template.aliases || []).some((alias) => normalizeSearchText(alias) === normalized)
  ));
}

function projectItemTemplate(template, {
  includeFields = true,
  includeExamples = true
} = {}) {
  const output = {
    id: template.id,
    title: template.title,
    description: template.description,
    registered: template.registered,
    templateOnly: template.templateOnly,
    collection: template.collection,
    recordKey: template.recordKey,
    aliases: cloneJson(template.aliases),
    prefix: template.prefix,
    tags: cloneJson(template.tags),
    fieldNames: cloneJson(template.fieldNames),
    notes: cloneJson(template.notes)
  };
  if (includeFields) output.fields = cloneJson(template.fields);
  if (includeExamples) {
    output.exampleRecord = cloneJson(template.exampleRecord);
    output.quantificationTemplate = cloneJson(template.quantificationTemplate);
  }
  return output;
}

export function normalizeItemKind(kind) {
  const normalized = normalizeSearchText(kind);
  for (const [id, config] of Object.entries(KIND_CONFIG)) {
    if (normalized === normalizeSearchText(id)) return id;
    if (normalized === normalizeSearchText(config.recordKey)) return id;
    if (normalized === normalizeSearchText(config.collection)) return id;
    if (config.aliases.some((alias) => normalized === normalizeSearchText(alias))) return id;
  }
  if (['special', 'artifact', 'artifacts', 'relic', 'relics', 'quest_item', 'quest_items', 'key_item', 'key_items'].includes(normalized)) return 'special_item';
  throw validationError(`Unsupported item kind: ${kind}`);
}

export function normalizeItemId(value, prefix = 'item') {
  const base = String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 128);
  return base || `${prefix}_${shortHash(value)}`;
}

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return [...new Set((Array.isArray(value) ? value : String(value).split(','))
    .map((item) => String(item).trim())
    .filter(Boolean))];
}

function normalizeArrayOrObject(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return value;
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeJsonLike(value) {
  if (value === undefined || value === null || value === '') return {};
  return value;
}

function normalizeNumericValues(value) {
  if (value === undefined || value === null || value === '') return {};
  if (!hasPlainObject(value)) throw validationError('numericValues must be a plain object');
  const output = {};
  for (const [field, rawValue] of Object.entries(value)) {
    const name = normalizeSettingFieldName(field);
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;
    const number = Number(rawValue);
    if (!Number.isFinite(number)) {
      throw validationError(`numericValues.${name} must be a finite number`);
    }
    output[name] = number;
  }
  return output;
}

function normalizePlainObject(value) {
  return hasPlainObject(value) ? value : {};
}

function hasPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSettingFieldName(value) {
  const normalized = String(value || '').trim();
  if (!normalized) throw validationError('numericValues field name is required');
  if (normalized.length > 128) throw validationError(`numericValues field name is too long: ${normalized}`);
  return normalized;
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeMetadata(input) {
  const metadata = {
    ...(input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {})
  };
  for (const key of ['source', 'importSource', 'campaignId', 'chatSessionId', 'characterCardId']) {
    if (input[key] !== undefined) metadata[key] = input[key];
  }
  if (input.metadata?.resourceLifecycle) metadata.resourceLifecycle = input.metadata.resourceLifecycle;
  return metadata;
}

function lifecycleImportDefaults(input = {}) {
  return {
    resourceLifecycle: input.resourceLifecycle,
    lifecycleScope: input.lifecycleScope,
    lifecycleLevel: input.lifecycleLevel,
    importanceLevel: input.importanceLevel,
    characterCardId: input.characterCardId,
    chatSessionId: input.chatSessionId
  };
}

function isAgentAuthored(input = {}, context = {}) {
  return isAgentMarker(input.actor)
    || isAgentMarker(input.createdBy)
    || isAgentMarker(input.updatedBy)
    || isAgentMarker(input.sourceActor)
    || isAgentMarker(input.author)
    || isAgentMarker(context.actor)
    || isAgentMarker(context.sourceActor)
    || isAgentMarker(context.caller)
    || isAgentMarker(context.author);
}

function isAgentMarker(value) {
  if (!value) return false;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return isAgentMarker(value.type) || isAgentMarker(value.role) || isAgentMarker(value.kind);
  }
  const normalized = String(value).trim().toLowerCase();
  return ['agent', 'assistant', 'ai', 'llm', 'gm'].includes(normalized);
}

function normalizeSearchText(value) {
  return String(value || '').normalize('NFKC').toLowerCase();
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'ItemRegistryValidationError';
  error.statusCode = 400;
  return error;
}

function shortHash(value) {
  let hash = 0x811c9dc5;
  const text = String(value || 'item');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
