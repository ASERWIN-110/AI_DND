// @ts-nocheck
import { ResourceManager } from '../resources/resource-manager.js';

export const RESOURCE_PLUGIN = {
  id: 'system.resources',
  name: 'Resource And Action Economy Tools',
  version: '0.1.0',
  description: 'Deterministic no-LLM tools for action/bonus action/reaction/movement, spell slots, skill uses, ammo, cooldowns, and consumables.',
  enabled: true,
  permissions: ['resources:read', 'resources:write'],
  metadata: {
    llm: false,
    stateTarget: 'npc_structured_states.resources'
  },
  tools: [
    {
      name: 'describe_resources',
      title: 'Describe Resource Manager',
      description: 'Describe the deterministic resource/action-economy state model and templates.',
      inputSchema: emptySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['resources', 'action-economy', 'templates', 'no-llm']
    },
    {
      name: 'get_actor_resources',
      title: 'Get Actor Resources',
      description: 'Read one NPC/PC resource snapshot from npc_structured_states.',
      inputSchema: actorIdentitySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['resources', 'query', 'npc-state', 'no-llm']
    },
    {
      name: 'reset_action_economy',
      title: 'Reset Action Economy',
      description: 'Reset action, bonus action, reaction, and/or movement to max for a turn or round.',
      inputSchema: resetActionEconomySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        writesTrace: true
      },
      tags: ['resources', 'action-economy', 'turn', 'write', 'no-llm']
    },
    {
      name: 'spend_action_economy',
      title: 'Spend Action Economy',
      description: 'Spend action, bonus action, reaction, or movement. Movement requires an amount/distance/cost.',
      inputSchema: actionEconomyDeltaSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        writesTrace: true
      },
      tags: ['resources', 'action-economy', 'spend', 'write', 'no-llm']
    },
    {
      name: 'restore_action_economy',
      title: 'Restore Action Economy',
      description: 'Restore action, bonus action, reaction, or movement, capped by max unless amount is omitted, which restores to full.',
      inputSchema: actionEconomyDeltaSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        writesTrace: true
      },
      tags: ['resources', 'action-economy', 'restore', 'write', 'no-llm']
    },
    {
      name: 'set_resource',
      title: 'Set Actor Resource',
      description: 'Create or update spell slots, skill uses, ammo, cooldown-like counters, consumables, or custom resource pools.',
      inputSchema: setResourceSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        idempotent: true,
        writesTrace: true
      },
      tags: ['resources', 'set', 'spell-slots', 'skill-uses', 'ammo', 'consumables', 'write', 'no-llm']
    },
    {
      name: 'spend_resource',
      title: 'Spend Actor Resource',
      description: 'Spend a non-action resource pool, such as spell slots, skill uses, ammunition, or charges.',
      inputSchema: resourceDeltaSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        writesTrace: true
      },
      tags: ['resources', 'spend', 'spell-slots', 'skill-uses', 'ammo', 'write', 'no-llm']
    },
    {
      name: 'restore_resource',
      title: 'Restore Actor Resource',
      description: 'Restore a non-action resource pool, capped by max.',
      inputSchema: resourceDeltaSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        writesTrace: true
      },
      tags: ['resources', 'restore', 'write', 'no-llm']
    },
    {
      name: 'start_cooldown',
      title: 'Start Cooldown',
      description: 'Start or restart a cooldown counter measured in turns.',
      inputSchema: cooldownSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        writesTrace: true
      },
      tags: ['resources', 'cooldown', 'turn', 'write', 'no-llm']
    },
    {
      name: 'tick_cooldowns',
      title: 'Tick Cooldowns',
      description: 'Reduce cooldown counters for one actor or a filtered set of actors. Ready cooldowns stay at zero unless force is true.',
      inputSchema: tickCooldownsSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        writesTrace: true
      },
      tags: ['resources', 'cooldown', 'turn', 'write', 'no-llm']
    },
    {
      name: 'consume_item',
      title: 'Consume Item Resource',
      description: 'Spend a consumable resource and, by default, synchronize inventory.items.quantity for the same item id.',
      inputSchema: consumeItemSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        writesTrace: true
      },
      tags: ['resources', 'consumables', 'inventory', 'write', 'no-llm']
    }
  ]
};

export function createResourceHandlers({ appDatabase, npcState, stateDatabase, manager, trace } = {}) {
  const resources = manager || new ResourceManager({
    appDatabase,
    npcState,
    stateDatabase,
    trace
  });
  return {
    describe_resources: async () => resources.describe(),
    get_actor_resources: async ({ input }) => resources.getActorResources(input),
    reset_action_economy: async ({ input }) => resources.resetActionEconomy(input),
    spend_action_economy: async ({ input }) => resources.spendActionEconomy(input),
    restore_action_economy: async ({ input }) => resources.restoreActionEconomy(input),
    set_resource: async ({ input }) => resources.setResource(input),
    spend_resource: async ({ input }) => resources.spendResource(input),
    restore_resource: async ({ input }) => resources.restoreResource(input),
    start_cooldown: async ({ input }) => resources.startCooldown(input),
    tick_cooldowns: async ({ input }) => resources.tickCooldowns(input),
    consume_item: async ({ input }) => resources.consumeItem(input)
  };
}

function emptySchema() {
  return {
    type: 'object',
    properties: {},
    additionalProperties: false
  };
}

function actorIdentityProperties() {
  return {
    chatSessionId: { type: 'string' },
    sceneId: { type: 'string', default: 'current' },
    npcId: { type: 'string' },
    actorId: { type: 'string' },
    playerId: { type: 'string' },
    recordId: { type: 'string' },
    stateRecordId: { type: 'string' },
    actorType: { type: 'string' },
    isPlayer: { type: 'boolean' },
    actorName: { type: 'string' },
    source: { type: 'string' }
  };
}

function actorIdentitySchema() {
  return {
    type: 'object',
    properties: actorIdentityProperties(),
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function resetActionEconomySchema() {
  return {
    type: 'object',
    properties: {
      ...actorIdentityProperties(),
      reset: stringOrStringArraySchema(),
      resources: stringOrStringArraySchema(),
      movementMax: { type: 'number', minimum: 0 },
      speed: { type: 'number', minimum: 0 },
      movementUnit: { type: 'string', default: 'ft' },
      turnId: { type: 'string' },
      turnNumber: {},
      roundNumber: {}
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function actionEconomyDeltaSchema() {
  return {
    type: 'object',
    properties: {
      ...actorIdentityProperties(),
      resource: { type: 'string', description: 'action, bonusAction, reaction, or movement' },
      actionType: { type: 'string' },
      type: { type: 'string' },
      kind: { type: 'string' },
      amount: { type: 'number', minimum: 0 },
      value: { type: 'number', minimum: 0 },
      distance: { type: 'number', minimum: 0 },
      feet: { type: 'number', minimum: 0 },
      meters: { type: 'number', minimum: 0 },
      cost: { type: 'number', minimum: 0 },
      allowOverspend: { type: 'boolean', default: false }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function setResourceSchema() {
  return {
    type: 'object',
    properties: {
      ...resourceIdentityProperties(),
      current: { type: 'number' },
      value: { type: 'number' },
      amount: { type: 'number' },
      max: { type: 'number' },
      maxValue: { type: 'number' },
      maximum: { type: 'number' },
      itemId: { type: 'string' },
      recharge: { type: 'string' },
      unit: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function resourceDeltaSchema() {
  return {
    type: 'object',
    properties: {
      ...resourceIdentityProperties(),
      amount: { type: 'number', minimum: 0, default: 1 },
      value: { type: 'number', minimum: 0 },
      itemId: { type: 'string' },
      inventoryItemId: { type: 'string' },
      itemName: { type: 'string' },
      syncInventory: { type: 'boolean' },
      allowOverspend: { type: 'boolean', default: false },
      removeWhenZero: { type: 'boolean', default: false }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function cooldownSchema() {
  return {
    type: 'object',
    properties: {
      ...actorIdentityProperties(),
      cooldownId: { type: 'string' },
      resourceId: { type: 'string' },
      id: { type: 'string' },
      name: { type: 'string' },
      remainingTurns: { type: 'integer', minimum: 0 },
      turns: { type: 'integer', minimum: 0 },
      durationTurns: { type: 'integer', minimum: 0 },
      duration: { type: 'integer', minimum: 0 },
      maxTurns: { type: 'integer', minimum: 0 },
      metadata: { type: 'object', additionalProperties: true }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function tickCooldownsSchema() {
  return {
    type: 'object',
    properties: {
      ...actorIdentityProperties(),
      cooldownIds: stringOrStringArraySchema(),
      cooldownId: { type: 'string' },
      resourceId: { type: 'string' },
      amount: { type: 'integer', minimum: 0, default: 1 },
      turns: { type: 'integer', minimum: 0 },
      force: { type: 'boolean', default: false },
      limit: { type: 'integer', minimum: 1, maximum: 1000 }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function consumeItemSchema() {
  return {
    type: 'object',
    properties: {
      ...resourceIdentityProperties(),
      itemId: { type: 'string' },
      inventoryItemId: { type: 'string' },
      itemName: { type: 'string' },
      quantity: { type: 'number', minimum: 0 },
      amount: { type: 'number', minimum: 0, default: 1 },
      value: { type: 'number', minimum: 0 },
      syncInventory: { type: 'boolean', default: true },
      allowOverspend: { type: 'boolean', default: false },
      removeWhenZero: { type: 'boolean', default: false }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function resourceIdentityProperties() {
  return {
    ...actorIdentityProperties(),
    category: { type: 'string', description: 'spellSlots, skillUses, ammo, cooldowns, consumables, or a custom group' },
    resourceType: { type: 'string' },
    type: { type: 'string' },
    resourceId: { type: 'string' },
    id: { type: 'string' },
    name: { type: 'string' },
    slotLevel: {
      oneOf: [
        { type: 'string' },
        { type: 'integer', minimum: 0 }
      ]
    },
    level: {
      oneOf: [
        { type: 'string' },
        { type: 'integer', minimum: 0 }
      ]
    }
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
