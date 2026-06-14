// @ts-nocheck
import { SlotUseResolver } from '../slots/slot-use-resolver.js';

export const SLOT_USE_PLUGIN = {
  id: 'system.slot_use',
  name: 'Slot Use Tools',
  version: '0.1.0',
  description: 'Unified UI-facing backend for using inventory items and skill-bar actions, with deterministic routing and adjudication gating for special text.',
  enabled: true,
  permissions: ['slot-use:read', 'slot-use:write'],
  metadata: {
    llm: false,
    scope: 'chat-session',
    reuses: ['system.item_use', 'system.combat', 'system.effects', 'system.resources', 'system.action']
  },
  tools: [
    tool('describe_slot_use', 'Describe Slot Use', 'Describe quick-use routing for inventory items and skill-bar actions.', emptySchema(), false, true, ['slot-use', 'schema', 'no-llm']),
    tool('list_slots', 'List Usable Slots', 'List inventory and skill-bar entries that a UI can show as clickable slots.', slotListSchema(), false, true, ['slot-use', 'ui', 'inventory', 'skills', 'no-llm']),
    tool('preview_use', 'Preview Slot Use', 'Preview a clicked item or skill use. Returns target needs, deterministic preview, or adjudication proposal without mutating state.', slotUseSchema(), false, true, ['slot-use', 'preview', 'no-llm']),
    tool('commit_use', 'Commit Slot Use', 'Execute a deterministic clicked item or skill use. Special textual effects are routed to adjudication unless explicitly executed.', slotUseSchema(), true, false, ['slot-use', 'write', 'inventory', 'skills', 'effects'])
  ]
};

export function createSlotUseHandlers({ toolManager, resolver, trace } = {}) {
  const slotUse = resolver || new SlotUseResolver({
    toolManager,
    trace
  });
  return {
    describe_slot_use: async () => slotUse.describe(),
    list_slots: async ({ input, context }) => slotUse.listSlots(input, context),
    preview_use: async ({ input, context }) => slotUse.previewUse(input, context),
    commit_use: async ({ input, context }) => slotUse.commitUse(input, context)
  };
}

function tool(name, title, description, inputSchema, mutatesState, autoCallable, tags) {
  return {
    name,
    title,
    description,
    inputSchema,
    visibility: 'public',
    autoCallable,
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

function slotListSchema() {
  return {
    type: 'object',
    properties: {
      ...actorIdentityProperties(),
      includeBasicAttack: { type: 'boolean', default: false },
      metadata: { type: 'object', additionalProperties: true }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function slotUseSchema() {
  return {
    type: 'object',
    properties: {
      ...actorIdentityProperties(),
      sourceKind: { type: 'string' },
      slotKind: { type: 'string' },
      kind: { type: 'string' },
      slotId: { type: 'string' },
      selectedSlotId: { type: 'string' },
      id: { type: 'string' },
      itemId: { type: 'string' },
      inventoryItemId: { type: 'string' },
      itemName: { type: 'string' },
      name: { type: 'string' },
      itemKind: { type: 'string' },
      registryKind: { type: 'string' },
      skillId: { type: 'string' },
      selectedActionId: { type: 'string' },
      actionId: { type: 'string' },
      useId: { type: 'string' },
      battleId: { type: 'string' },
      useMode: { type: 'string' },
      mode: { type: 'string' },
      executionMode: { type: 'string' },
      modeOverride: { type: 'string' },
      directUseAllowed: { type: 'boolean' },
      requiresAdjudication: { type: 'boolean' },
      executeAdjudication: { type: 'boolean', default: false },
      useLlm: { type: 'boolean', default: false },
      specialText: { type: 'string' },
      specialHandling: { type: 'object', additionalProperties: true },
      adjudicationTool: { type: 'string' },
      targetPolicy: { type: 'string' },
      targetMode: { type: 'string' },
      targetId: { type: 'string' },
      targetNpcId: { type: 'string' },
      targetIds: stringOrStringArraySchema(),
      targets: stringOrStringArraySchema(),
      consumeAction: { type: 'boolean' },
      consumeItem: { type: 'boolean' },
      consumeQuantity: { type: 'number', minimum: 0 },
      quantity: { type: 'number', minimum: 0 },
      amount: { type: 'number', minimum: 0 },
      requireOwned: { type: 'boolean', default: true },
      requiresEquipped: { type: 'boolean', default: false },
      requireEquipped: { type: 'boolean', default: false },
      slot: { type: 'string' },
      hit: hitSchema(),
      hitResult: hitSchema(),
      item: { type: 'object', additionalProperties: true },
      effects: { type: 'object', additionalProperties: true },
      useEffects: { type: 'object', additionalProperties: true },
      damage: effectSchema(),
      damages: effectSchema(),
      damageRolls: { type: 'array', items: { type: 'object', additionalProperties: true } },
      damageDice: { type: 'array', items: { type: 'object', additionalProperties: true } },
      healing: effectSchema(),
      heals: effectSchema(),
      healingRolls: { type: 'array', items: { type: 'object', additionalProperties: true } },
      healingDice: { type: 'array', items: { type: 'object', additionalProperties: true } },
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
      dryRun: { type: 'boolean', default: false },
      recordEvent: { type: 'boolean' },
      useModifierResolver: { type: 'boolean' },
      applyModifiers: { type: 'boolean' },
      includeBasicAttack: { type: 'boolean', default: false },
      metadata: { type: 'object', additionalProperties: true },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function actorIdentityProperties() {
  return {
    chatSessionId: { type: 'string' },
    chatId: { type: 'string' },
    sessionId: { type: 'string' },
    sceneId: { type: 'string', default: 'current' },
    actorId: { type: 'string' },
    npcId: { type: 'string' },
    playerId: { type: 'string' },
    actorType: { type: 'string' },
    isPlayer: { type: 'boolean' },
    actorName: { type: 'string' },
    source: { type: 'string' }
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
