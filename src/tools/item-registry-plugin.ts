// @ts-nocheck
import { ItemRegistry } from '../items/item-registry.js';
import { lifecycleSchemaProperties } from '../lifecycle/resource-lifecycle.js';

const AUTH_METADATA = {
  requiresUserAuthorization: true
};

export const ITEM_REGISTRY_PLUGIN = {
  id: 'system.item_registry',
  name: 'Item Registry Tools',
  version: '0.1.0',
  description: 'Global item registries for items, equipment, accessories, weapons, mounts, and special items.',
  enabled: true,
  permissions: ['item-registry:read', 'item-registry:write'],
  tools: [
    ...itemTools('item', 'items', 'Item'),
    ...itemTools('equipment', 'equipment', 'Equipment'),
    ...itemTools('accessory', 'accessories', 'Accessory'),
    ...itemTools('weapon', 'weapons', 'Weapon'),
    ...itemTools('mount', 'mounts', 'Mount'),
    ...itemTools('special_item', 'special_items', 'Special Item'),
    {
      name: 'list_templates',
      title: 'List Item Templates',
      description: 'List editable item templates for items, equipment, accessories, weapons, mounts, and special items.',
      inputSchema: templateListSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['item', 'registry', 'templates', 'query']
    },
    {
      name: 'get_template',
      title: 'Get Item Template',
      description: 'Get one editable item template by id or alias.',
      inputSchema: templateIdSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['item', 'registry', 'templates', 'query']
    },
    {
      name: 'import_document',
      title: 'Import Item Registry Document',
      description: 'Import item registry entries from JSON, YAML, or XML. Requires explicit user authorization.',
      inputSchema: importSchema(),
      annotations: { requiresUserAuthorization: true },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: AUTH_METADATA,
      tags: ['item', 'registry', 'import', 'json', 'yaml', 'xml']
    },
    {
      name: 'export_document',
      title: 'Export Item Registry Document',
      description: 'Export item registry entries to JSON or YAML.',
      inputSchema: exportSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['item', 'registry', 'export', 'json', 'yaml']
    },
    {
      name: 'describe_registry',
      title: 'Describe Item Registry',
      description: 'Describe the underlying item registry collections and synchronized schema files.',
      inputSchema: emptySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['item', 'registry', 'schema']
    }
  ]
};

export function createItemRegistryHandlers({ dataManager, registry, appDatabase, chatProvider } = {}) {
  const items = registry || new ItemRegistry({ dataManager, appDatabase });
  return {
    list_items: async ({ input }) => items.listItems(input),
    get_item: async ({ input }) => items.getItem(input.id),
    upsert_item: async ({ input, context }) => items.upsertItemAsync(input, { context, chatProvider }),
    patch_item: async ({ input, context }) => items.patchItemAsync(input.id, input.patch, { context, chatProvider }),
    delete_item: async ({ input }) => items.deleteItem(input.id),
    list_equipment: async ({ input }) => items.listEquipment(input),
    get_equipment: async ({ input }) => items.getEquipment(input.id),
    upsert_equipment: async ({ input, context }) => items.upsertEquipmentAsync(input, { context, chatProvider }),
    patch_equipment: async ({ input, context }) => items.patchEquipmentAsync(input.id, input.patch, { context, chatProvider }),
    delete_equipment: async ({ input }) => items.deleteEquipment(input.id),
    list_accessories: async ({ input }) => items.listAccessories(input),
    get_accessory: async ({ input }) => items.getAccessory(input.id),
    upsert_accessory: async ({ input, context }) => items.upsertAccessoryAsync(input, { context, chatProvider }),
    patch_accessory: async ({ input, context }) => items.patchAccessoryAsync(input.id, input.patch, { context, chatProvider }),
    delete_accessory: async ({ input }) => items.deleteAccessory(input.id),
    list_weapons: async ({ input }) => items.listWeapons(input),
    get_weapon: async ({ input }) => items.getWeapon(input.id),
    upsert_weapon: async ({ input, context }) => items.upsertWeaponAsync(input, { context, chatProvider }),
    patch_weapon: async ({ input, context }) => items.patchWeaponAsync(input.id, input.patch, { context, chatProvider }),
    delete_weapon: async ({ input }) => items.deleteWeapon(input.id),
    list_mounts: async ({ input }) => items.listMounts(input),
    get_mount: async ({ input }) => items.getMount(input.id),
    upsert_mount: async ({ input, context }) => items.upsertMountAsync(input, { context, chatProvider }),
    patch_mount: async ({ input, context }) => items.patchMountAsync(input.id, input.patch, { context, chatProvider }),
    delete_mount: async ({ input }) => items.deleteMount(input.id),
    list_special_items: async ({ input }) => items.listSpecialItems(input),
    get_special_item: async ({ input }) => items.getSpecialItem(input.id),
    upsert_special_item: async ({ input, context }) => items.upsertSpecialItemAsync(input, { context, chatProvider }),
    patch_special_item: async ({ input, context }) => items.patchSpecialItemAsync(input.id, input.patch, { context, chatProvider }),
    delete_special_item: async ({ input }) => items.deleteSpecialItem(input.id),
    list_templates: async ({ input }) => items.listTemplates(input),
    get_template: async ({ input }) => items.getTemplate(input.templateId || input.id, input),
    import_document: async ({ input, context }) => items.importDocumentAsync(input, { context, chatProvider }),
    export_document: async ({ input }) => items.exportDocument(input),
    describe_registry: async () => items.describe()
  };
}

function itemTools(kind, plural, title) {
  return [
    {
      name: `list_${plural}`,
      title: `List ${title}`,
      description: `List ${kind} registry entries with optional filters, tags, and text query.`,
      inputSchema: listSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['item', kind, 'registry', 'query']
    },
    {
      name: `get_${kind}`,
      title: `Get ${title}`,
      description: `Get one ${kind} registry entry by id.`,
      inputSchema: idSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['item', kind, 'registry', 'query']
    },
    {
      name: `upsert_${kind}`,
      title: `Create Or Replace ${title}`,
      description: `Create or replace one ${kind} registry entry. Requires explicit user authorization.`,
      inputSchema: itemInputSchema(),
      annotations: { requiresUserAuthorization: true },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: AUTH_METADATA,
      tags: ['item', kind, 'registry', 'write']
    },
    {
      name: `patch_${kind}`,
      title: `Patch ${title}`,
      description: `Patch an existing ${kind} registry entry. Requires explicit user authorization.`,
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          patch: itemPatchSchema()
        },
        required: ['id', 'patch'],
        additionalProperties: false
      },
      annotations: { requiresUserAuthorization: true },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: AUTH_METADATA,
      tags: ['item', kind, 'registry', 'write']
    },
    {
      name: `delete_${kind}`,
      title: `Delete ${title}`,
      description: `Delete one ${kind} registry entry. Requires explicit user authorization.`,
      inputSchema: idSchema(),
      annotations: { requiresUserAuthorization: true },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        ...AUTH_METADATA,
        destructive: true
      },
      tags: ['item', kind, 'registry', 'delete']
    }
  ];
}

function itemInputSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      itemId: { type: 'string' },
      equipmentId: { type: 'string' },
      accessoryId: { type: 'string' },
      weaponId: { type: 'string' },
      mountId: { type: 'string' },
      special_itemId: { type: 'string' },
      specialItemId: { type: 'string' },
      name: { type: 'string' },
      category: { type: 'string' },
      type: { type: 'string' },
      kind: { type: 'string' },
      rarity: { type: 'string' },
      tier: { type: 'string' },
      tags: stringArraySchema(),
      aliases: stringArraySchema(),
      description: { type: 'string' },
      summary: { type: 'string' },
      text: { type: 'string' },
      mechanicalEffect: { type: 'string' },
      effect: { type: 'string' },
      rule: { type: 'string' },
      rulesText: { type: 'string' },
      lore: { type: 'string' },
      flavor: { type: 'string' },
      backstory: { type: 'string' },
      value: jsonLikeSchema(),
      price: jsonLikeSchema(),
      cost: jsonLikeSchema(),
      weight: jsonLikeSchema(),
      bulk: jsonLikeSchema(),
      encumbrance: jsonLikeSchema(),
      requirements: arrayOrObjectSchema(),
      prerequisites: arrayOrObjectSchema(),
      requires: arrayOrObjectSchema(),
      grants: arrayOrObjectSchema(),
      bonuses: arrayOrObjectSchema(),
      unlocks: arrayOrObjectSchema(),
      relatedSkillIds: stringArraySchema(),
      skillRefs: stringArraySchema(),
      skills: stringArraySchema(),
      relatedStatusIds: stringArraySchema(),
      statusRefs: stringArraySchema(),
      statuses: stringArraySchema(),
      relatedFeatIds: stringArraySchema(),
      featRefs: stringArraySchema(),
      feats: stringArraySchema(),
      sourceRef: { type: 'string' },
      source: { type: 'string' },
      bookRef: { type: 'string' },
      status: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true },
      campaignId: { type: 'string' },
      chatSessionId: { type: 'string' },
      itemType: { type: 'string' },
      stackRule: { type: 'string' },
      stacking: { type: 'string' },
      stackable: { type: 'boolean' },
      uses: jsonLikeSchema(),
      useRules: jsonLikeSchema(),
      consumable: jsonLikeSchema(),
      charges: jsonLikeSchema(),
      chargeRules: jsonLikeSchema(),
      container: jsonLikeSchema(),
      contents: jsonLikeSchema(),
      capacity: jsonLikeSchema(),
      equipmentType: { type: 'string' },
      slot: { type: 'string' },
      bodySlot: { type: 'string' },
      equipSlot: { type: 'string' },
      armorType: { type: 'string' },
      armor: { type: 'string' },
      armorClass: jsonLikeSchema(),
      ac: jsonLikeSchema(),
      defense: jsonLikeSchema(),
      defenses: jsonLikeSchema(),
      resistances: jsonLikeSchema(),
      attunement: jsonLikeSchema(),
      requiresAttunement: jsonLikeSchema(),
      durability: jsonLikeSchema(),
      condition: jsonLikeSchema(),
      repair: jsonLikeSchema(),
      materials: arrayOrObjectSchema(),
      components: arrayOrObjectSchema(),
      accessoryType: { type: 'string' },
      jewelryType: { type: 'string' },
      activation: jsonLikeSchema(),
      trigger: jsonLikeSchema(),
      action: jsonLikeSchema(),
      cooldown: jsonLikeSchema(),
      recharge: jsonLikeSchema(),
      drawbacks: arrayOrObjectSchema(),
      curses: arrayOrObjectSchema(),
      sideEffects: arrayOrObjectSchema(),
      weaponType: { type: 'string' },
      handedness: { type: 'string' },
      hands: { type: 'string' },
      grip: { type: 'string' },
      damage: jsonLikeSchema(),
      damageDice: jsonLikeSchema(),
      damageFormula: jsonLikeSchema(),
      damageType: { type: 'string' },
      element: { type: 'string' },
      range: jsonLikeSchema(),
      reach: jsonLikeSchema(),
      distance: jsonLikeSchema(),
      properties: arrayOrObjectSchema(),
      traits: arrayOrObjectSchema(),
      proficiency: jsonLikeSchema(),
      proficiencies: jsonLikeSchema(),
      ammunition: jsonLikeSchema(),
      ammo: jsonLikeSchema(),
      reload: jsonLikeSchema(),
      enchantment: jsonLikeSchema(),
      magic: jsonLikeSchema(),
      upgrades: jsonLikeSchema(),
      mountType: { type: 'string' },
      vehicleType: { type: 'string' },
      creatureType: { type: 'string' },
      species: { type: 'string' },
      size: { type: 'string' },
      speed: jsonLikeSchema(),
      speeds: jsonLikeSchema(),
      movement: jsonLikeSchema(),
      carryingCapacity: jsonLikeSchema(),
      cargo: jsonLikeSchema(),
      temperament: { type: 'string' },
      disposition: { type: 'string' },
      training: jsonLikeSchema(),
      commands: jsonLikeSchema(),
      tricks: jsonLikeSchema(),
      upkeep: jsonLikeSchema(),
      maintenance: jsonLikeSchema(),
      feed: jsonLikeSchema(),
      fuel: jsonLikeSchema(),
      combatRole: jsonLikeSchema(),
      combat: jsonLikeSchema(),
      actions: jsonLikeSchema(),
      equipmentSlots: jsonLikeSchema(),
      slots: jsonLikeSchema(),
      upgradeSlots: jsonLikeSchema(),
      specialType: { type: 'string' },
      artifactType: { type: 'string' },
      ritual: jsonLikeSchema(),
      questRefs: stringArraySchema(),
      quests: stringArraySchema(),
      sceneRefs: stringArraySchema(),
      boundTo: jsonLikeSchema(),
      owner: jsonLikeSchema(),
      bearer: jsonLikeSchema(),
      sentience: jsonLikeSchema(),
      personality: jsonLikeSchema(),
      ego: jsonLikeSchema(),
      lifecycle: jsonLikeSchema(),
      state: jsonLikeSchema(),
      states: jsonLikeSchema(),
      actor: actorMarkerSchema(),
      createdBy: { type: 'string' },
      updatedBy: { type: 'string' },
      sourceActor: { type: 'string' },
      author: { type: 'string' },
      numericValues: numericValuesSchema(),
      values: numericValuesSchema(),
      numericSettings: numericValuesSchema(),
      settingValues: numericValuesSchema(),
      textSettings: jsonObjectSchema(),
      specialTextSettings: jsonObjectSchema(),
      quantify: { type: 'boolean' },
      quantifyNumeric: { type: 'boolean' },
      autoQuantify: { type: 'boolean' },
      quantificationDefinition: quantificationDefinitionSchema(),
      numericDefinition: quantificationDefinitionSchema(),
      definition: quantificationDefinitionSchema(),
      quantification: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          definition: quantificationDefinitionSchema()
        },
        additionalProperties: true
      },
      quantificationValues: jsonObjectSchema(),
      providedValues: jsonObjectSchema(),
      quantificationSourceText: { type: 'string' },
      numericSourceText: { type: 'string' },
      quantificationText: { type: 'string' },
      quantificationAudit: jsonObjectSchema(),
      numericQuantification: jsonObjectSchema(),
      quantificationUpdatedAt: { type: 'string' },
      useLlm: { type: 'boolean' },
      preferLlm: { type: 'boolean' },
      requireLlm: { type: 'boolean' },
      allowNewFields: { type: 'boolean' },
      maxNewFields: { type: 'integer', minimum: 0, maximum: 50 },
      referenceText: referenceInputSchema(),
      referenceDocuments: referenceInputSchema(),
      referenceDocs: referenceInputSchema(),
      referenceFiles: referenceInputSchema(),
      referenceFilePaths: referenceInputSchema(),
      allowReferenceFilePaths: { type: 'boolean' },
      cwd: { type: 'string' },
      temperature: { type: 'number' },
      maxTokens: { type: 'integer', minimum: 1 },
      newFieldsMaxTokens: { type: 'integer', minimum: 1 },
      ...lifecycleSchemaProperties()
    },
    required: ['name'],
    additionalProperties: false
  };
}

function itemPatchSchema() {
  const schema = itemInputSchema();
  delete schema.required;
  return schema;
}

function listSchema() {
  return {
    type: 'object',
    properties: {
      filter: { type: 'object', additionalProperties: true },
      tags: stringArraySchema(),
      query: { type: 'string' },
      sort: sortSchema(),
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 },
      ...lifecycleSchemaProperties()
    },
    additionalProperties: false
  };
}

function idSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' }
    },
    required: ['id'],
    additionalProperties: false
  };
}

function templateListSchema() {
  return {
    type: 'object',
    properties: {
      query: { type: 'string' },
      includeFields: { type: 'boolean', default: true },
      includeExamples: { type: 'boolean', default: true }
    },
    additionalProperties: false
  };
}

function templateIdSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      templateId: { type: 'string' },
      includeFields: { type: 'boolean', default: true },
      includeExamples: { type: 'boolean', default: true }
    },
    anyOf: [
      { required: ['id'] },
      { required: ['templateId'] }
    ],
    additionalProperties: false
  };
}

function importSchema() {
  return {
    type: 'object',
    properties: {
      text: { type: 'string', minLength: 1 },
      format: { type: 'string', enum: ['auto', 'json', 'yaml', 'yml', 'xml'], default: 'auto' },
      kind: { type: 'string' },
      collection: { type: 'string' },
      collectionMap: { type: 'object', additionalProperties: { type: 'string' } },
      idField: { type: 'string', default: 'id' },
      source: { type: 'string', default: 'agent-import' },
      useLlm: { type: 'boolean' },
      preferLlm: { type: 'boolean' },
      requireLlm: { type: 'boolean' },
      allowNewFields: { type: 'boolean' },
      maxNewFields: { type: 'integer', minimum: 0, maximum: 50 },
      referenceText: referenceInputSchema(),
      referenceDocuments: referenceInputSchema(),
      referenceDocs: referenceInputSchema(),
      referenceFiles: referenceInputSchema(),
      referenceFilePaths: referenceInputSchema(),
      allowReferenceFilePaths: { type: 'boolean' },
      cwd: { type: 'string' },
      temperature: { type: 'number' },
      maxTokens: { type: 'integer', minimum: 1 },
      newFieldsMaxTokens: { type: 'integer', minimum: 1 },
      ...lifecycleSchemaProperties()
    },
    required: ['text'],
    additionalProperties: false
  };
}

function exportSchema() {
  return {
    type: 'object',
    properties: {
      format: { type: 'string', enum: ['json', 'yaml', 'yml'], default: 'json' },
      kind: { type: 'string' },
      filter: { type: 'object', additionalProperties: true },
      tags: stringArraySchema(),
      query: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 }
    },
    additionalProperties: false
  };
}

function sortSchema() {
  return {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        field: { type: 'string' },
        direction: { type: 'string', enum: ['asc', 'desc'] }
      },
      required: ['field'],
      additionalProperties: false
    }
  };
}

function stringArraySchema() {
  return {
    anyOf: [
      { type: 'array', items: { type: 'string' } },
      { type: 'string' }
    ]
  };
}

function arrayOrObjectSchema() {
  return {
    anyOf: [
      { type: 'array', items: true },
      { type: 'object', additionalProperties: true },
      { type: 'string' }
    ]
  };
}

function jsonLikeSchema() {
  return {
    anyOf: [
      { type: 'array', items: true },
      { type: 'object', additionalProperties: true },
      { type: 'string' },
      { type: 'number' },
      { type: 'integer' },
      { type: 'boolean' }
    ]
  };
}

function numericValuesSchema() {
  return {
    type: 'object',
    additionalProperties: {
      anyOf: [
        { type: 'number' },
        { type: 'integer' },
        { type: 'string' }
      ]
    }
  };
}

function jsonObjectSchema() {
  return {
    type: 'object',
    additionalProperties: true
  };
}

function quantificationDefinitionSchema() {
  return {
    type: 'object',
    properties: {
      version: { type: 'string' },
      prompt: { type: 'string' },
      fields: {
        type: 'array',
        items: { type: 'object', additionalProperties: true }
      },
      numericFields: {
        type: 'array',
        items: { type: 'object', additionalProperties: true }
      },
      textFields: {
        type: 'array',
        items: { type: 'object', additionalProperties: true }
      }
    },
    additionalProperties: true
  };
}

function actorMarkerSchema() {
  return {
    anyOf: [
      { type: 'string' },
      {
        type: 'object',
        additionalProperties: true
      }
    ]
  };
}

function referenceInputSchema() {
  return {
    anyOf: [
      { type: 'string' },
      {
        type: 'array',
        items: {
          anyOf: [
            { type: 'string' },
            { type: 'object', additionalProperties: true }
          ]
        }
      },
      { type: 'object', additionalProperties: true }
    ]
  };
}

function emptySchema() {
  return {
    type: 'object',
    properties: {},
    additionalProperties: false
  };
}
