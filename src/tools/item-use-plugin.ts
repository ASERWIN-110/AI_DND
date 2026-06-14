// @ts-nocheck
import { ItemUseResolver } from '../items/item-use-resolver.js';

export const ITEM_USE_PLUGIN = {
  id: 'system.item_use',
  name: 'Item Use And Equipment Settlement Tools',
  version: '0.1.0',
  description: 'Deterministic no-LLM resolver for owned item usage, equipping, unequipping, inventory consumption, effects, and resource changes.',
  enabled: true,
  permissions: ['item-use:read', 'item-use:write'],
  metadata: {
    llm: false,
    stateTarget: 'npc_structured_states',
    reuses: ['system.item_registry', 'system.npc_state', 'system.effects', 'system.resources']
  },
  tools: [
    tool('describe_resolver', 'Describe Item Use Resolver', 'Describe item usage flow, state boundaries, reused tools, and debug templates.', emptySchema(), false, ['item', 'equipment', 'schema', 'templates', 'no-llm']),
    tool('preview_use_item', 'Preview Item Use', 'Validate owned item usage and preview healing/damage/status/resource effects without writing state.', useItemSchema(), false, ['item', 'use', 'preview', 'effects', 'resources', 'no-llm']),
    tool('use_item', 'Use Item', 'Use an owned or explicitly virtual item: check ownership/equipment/consumption, apply healing/damage/status/resource changes, then write inventory and Actor state.', useItemSchema(), true, ['item', 'use', 'inventory', 'effects', 'resources', 'write', 'no-llm']),
    tool('equip_item', 'Equip Item', 'Equip an owned inventory item into an equipment slot and mirror equipped=true in inventory.', equipSchema(), true, ['item', 'equipment', 'equip', 'inventory', 'write', 'no-llm']),
    tool('unequip_item', 'Unequip Item', 'Unequip an item by item id or slot and mirror equipped=false in inventory.', equipSchema(), true, ['item', 'equipment', 'unequip', 'inventory', 'write', 'no-llm'])
  ]
};

export function createItemUseHandlers({ toolManager, resolver, trace } = {}) {
  const itemUse = resolver || new ItemUseResolver({
    toolManager,
    trace
  });
  return {
    describe_resolver: async () => itemUse.describe(),
    preview_use_item: async ({ input }) => itemUse.previewUseItem(input),
    use_item: async ({ input }) => itemUse.useItem(input),
    equip_item: async ({ input }) => itemUse.equipItem(input),
    unequip_item: async ({ input }) => itemUse.unequipItem(input)
  };
}

function tool(name, title, description, inputSchema, mutatesState, tags) {
  return {
    name,
    title,
    description,
    inputSchema,
    visibility: 'public',
    autoCallable: true,
    mutatesState,
    metadata: {
      scope: 'chat-session',
      writesTrace: true,
      llm: false
    },
    tags
  };
}

function emptySchema() {
  return {
    type: 'object',
    properties: {},
    additionalProperties: false
  };
}

function useItemSchema() {
  return {
    type: 'object',
    properties: {
      ...actorIdentityProperties(),
      itemId: { type: 'string' },
      inventoryItemId: { type: 'string' },
      id: { type: 'string' },
      itemName: { type: 'string' },
      name: { type: 'string' },
      itemKind: { type: 'string' },
      registryKind: { type: 'string' },
      kind: { type: 'string' },
      useMode: { type: 'string' },
      mode: { type: 'string' },
      targetId: { type: 'string' },
      targetNpcId: { type: 'string' },
      targetPlayerId: { type: 'string' },
      targetIds: stringOrStringArraySchema(),
      target: targetSchema(),
      targets: {
        type: 'array',
        items: targetSchema()
      },
      requireOwned: { type: 'boolean', default: true },
      requiresEquipped: { type: 'boolean', default: false },
      requireEquipped: { type: 'boolean', default: false },
      consumeItem: { type: 'boolean' },
      consumeQuantity: { type: 'number', minimum: 0 },
      quantity: { type: 'number', minimum: 0 },
      amount: { type: 'number', minimum: 0 },
      consumeCategory: { type: 'string' },
      resourceId: { type: 'string' },
      syncInventory: { type: 'boolean', default: true },
      removeWhenZero: { type: 'boolean', default: true },
      allowOverspend: { type: 'boolean', default: false },
      dryRun: { type: 'boolean', default: false },
      item: { type: 'object', additionalProperties: true },
      effects: { type: 'object', additionalProperties: true },
      useEffects: { type: 'object', additionalProperties: true },
      hit: hitSchema(),
      attack: hitSchema(),
      damage: effectSchema(),
      damages: effectSchema(),
      damageRolls: { type: 'array', items: diceRollSchema() },
      damageDice: { type: 'array', items: diceRollSchema() },
      healing: effectSchema(),
      heals: effectSchema(),
      healingRolls: { type: 'array', items: diceRollSchema() },
      healingDice: { type: 'array', items: diceRollSchema() },
      temporaryHp: {},
      tempHp: {},
      statusEffects: statusEffectArraySchema(),
      statuses: statusEffectArraySchema(),
      conditions: statusEffectArraySchema(),
      resourceChanges: {
        type: 'array',
        items: { type: 'object', additionalProperties: true }
      },
      resourceEffects: {
        type: 'array',
        items: { type: 'object', additionalProperties: true }
      },
      resourceCosts: {
        type: 'array',
        items: { type: 'object', additionalProperties: true }
      },
      costs: {
        type: 'array',
        items: { type: 'object', additionalProperties: true }
      },
      actionId: { type: 'string' },
      useId: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function equipSchema() {
  return {
    type: 'object',
    properties: {
      ...actorIdentityProperties(),
      itemId: { type: 'string' },
      inventoryItemId: { type: 'string' },
      id: { type: 'string' },
      itemName: { type: 'string' },
      name: { type: 'string' },
      itemKind: { type: 'string' },
      registryKind: { type: 'string' },
      kind: { type: 'string' },
      slot: { type: 'string' },
      equipSlot: { type: 'string' },
      bodySlot: { type: 'string' },
      equipmentSlot: { type: 'string' },
      requireOwned: { type: 'boolean', default: true },
      dryRun: { type: 'boolean', default: false },
      item: { type: 'object', additionalProperties: true },
      metadata: { type: 'object', additionalProperties: true }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function actorIdentityProperties() {
  return {
    chatSessionId: { type: 'string' },
    sceneId: { type: 'string', default: 'current' },
    actorId: { type: 'string' },
    npcId: { type: 'string' },
    playerId: { type: 'string' },
    recordId: { type: 'string' },
    stateRecordId: { type: 'string' },
    actorType: { type: 'string' },
    isPlayer: { type: 'boolean' },
    actorName: { type: 'string' },
    source: { type: 'string' }
  };
}

function targetSchema() {
  return {
    type: 'object',
    properties: {
      sceneId: { type: 'string' },
      npcId: { type: 'string' },
      actorId: { type: 'string' },
      playerId: { type: 'string' },
      id: { type: 'string' },
      name: { type: 'string' },
      actorType: { type: 'string' },
      isPlayer: { type: 'boolean' },
      hit: hitSchema(),
      attack: hitSchema(),
      damage: effectSchema(),
      damages: effectSchema(),
      healing: effectSchema(),
      heals: effectSchema(),
      temporaryHp: {},
      tempHp: {},
      statusEffects: statusEffectArraySchema(),
      statuses: statusEffectArraySchema(),
      conditions: statusEffectArraySchema(),
      defenses: { type: 'object', additionalProperties: true },
      resistances: stringOrStringArraySchema(),
      vulnerabilities: stringOrStringArraySchema(),
      immunities: stringOrStringArraySchema(),
      applyDamageOnMiss: { type: 'boolean' },
      allowHealingDead: { type: 'boolean' }
    },
    additionalProperties: true
  };
}

function effectSchema() {
  return {
    oneOf: [
      { type: 'number' },
      { type: 'object', additionalProperties: true },
      {
        type: 'array',
        items: {
          oneOf: [
            { type: 'number' },
            { type: 'object', additionalProperties: true }
          ]
        }
      }
    ]
  };
}

function statusEffectArraySchema() {
  return {
    oneOf: [
      { type: 'string' },
      { type: 'object', additionalProperties: true },
      {
        type: 'array',
        items: {
          oneOf: [
            { type: 'string' },
            { type: 'object', additionalProperties: true }
          ]
        }
      }
    ]
  };
}

function hitSchema() {
  return {
    oneOf: [
      { type: 'string' },
      { type: 'boolean' },
      { type: 'object', additionalProperties: true }
    ]
  };
}

function diceRollSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      type: { type: 'string' },
      diceCount: { type: 'integer', minimum: 1, maximum: 100 },
      rollCount: { type: 'integer', minimum: 1, maximum: 100 },
      count: { type: 'integer', minimum: 1, maximum: 100 },
      diceSides: { type: 'integer', minimum: 2, maximum: 10000 },
      sides: { type: 'integer', minimum: 2, maximum: 10000 },
      modifier: { type: 'integer' },
      fixedModifier: { type: 'integer' },
      buff: { type: 'integer' },
      debuff: { type: 'integer' },
      abilityModifier: { type: 'integer' },
      proficiencyBonus: { type: 'integer' },
      forceMode: { type: 'string' },
      rollMode: { type: 'string' },
      inspirationPoints: { type: 'integer', minimum: 0, maximum: 20 },
      criticalMode: { type: 'string' },
      note: { type: 'string' },
      description: { type: 'string' }
    },
    required: ['diceSides'],
    additionalProperties: false
  };
}

function stringOrStringArraySchema() {
  return {
    oneOf: [
      { type: 'string' },
      {
        type: 'array',
        items: { type: 'string' }
      }
    ]
  };
}
