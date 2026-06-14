// @ts-nocheck
import { EffectSettlementResolver } from '../combat/effect-settlement.js';

export const EFFECT_SETTLEMENT_PLUGIN = {
  id: 'system.effects',
  name: 'Damage Healing Status Settlement Tools',
  version: '0.1.0',
  description: 'Dice-independent hit damage, healing, temporary HP, resistance, concentration, death save, and status-effect settlement for NPC/PC Actor state.',
  enabled: true,
  permissions: ['effects:read', 'effects:write'],
  tools: [
    {
      name: 'describe_resolver',
      title: 'Describe Effect Settlement Resolver',
      description: 'Describe the dice-independent settlement flow, default D&D-like rules, and input templates.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['combat', 'effects', 'damage', 'healing', 'status', 'templates']
    },
    {
      name: 'preview_settlement',
      title: 'Preview Effect Settlement',
      description: 'Compute damage/healing/status settlement without writing state. The caller must supply hit and dice results; this tool never rolls dice.',
      inputSchema: settlementSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['combat', 'effects', 'preview', 'damage', 'healing']
    },
    {
      name: 'apply_settlement',
      title: 'Apply Effect Settlement',
      description: 'Compute settlement and write NPC/PC Actor state through npc_structured_states. The caller must supply hit and dice results; this tool never rolls dice.',
      inputSchema: settlementSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        writesTrace: true
      },
      tags: ['combat', 'effects', 'apply', 'damage', 'healing', 'status', 'write']
    }
  ]
};

export function createEffectSettlementHandlers({ appDatabase, npcState, stateDatabase, resolver, trace } = {}) {
  const effectSettlement = resolver || new EffectSettlementResolver({
    appDatabase,
    npcState,
    stateDatabase,
    trace
  });
  return {
    describe_resolver: async () => effectSettlement.describe(),
    preview_settlement: async ({ input }) => effectSettlement.previewSettlement(input),
    apply_settlement: async ({ input }) => effectSettlement.applySettlement(input)
  };
}

function settlementSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      settlementId: { type: 'string' },
      sourceActionId: { type: 'string' },
      actionId: { type: 'string' },
      source: { type: 'string' },
      rules: {
        type: 'object',
        additionalProperties: true
      },
      target: targetSchema(),
      targets: {
        type: 'array',
        items: targetSchema()
      },
      actor: targetSchema(),
      actors: {
        type: 'array',
        items: targetSchema()
      },
      npcId: { type: 'string' },
      playerId: { type: 'string' },
      actorId: { type: 'string' },
      id: { type: 'string' },
      name: { type: 'string' },
      actorType: { type: 'string' },
      isPlayer: { type: 'boolean' },
      player: { type: 'boolean' },
      hit: hitSchema(),
      attack: hitSchema(),
      outcome: {},
      damage: damageArraySchema(),
      damages: damageArraySchema(),
      damageRolls: damageArraySchema(),
      healing: healingArraySchema(),
      heals: healingArraySchema(),
      temporaryHp: temporaryHpSchema(),
      tempHp: temporaryHpSchema(),
      statusEffects: statusEffectArraySchema(),
      statuses: statusEffectArraySchema(),
      conditions: statusEffectArraySchema(),
      defenses: defenseSchema(),
      resistances: stringArraySchema(),
      vulnerabilities: stringArraySchema(),
      immunities: stringArraySchema(),
      concentration: { type: 'object', additionalProperties: true },
      concentrating: { type: 'boolean' },
      concentrationCheck: { type: 'object', additionalProperties: true },
      concentrationSave: { type: 'object', additionalProperties: true },
      deathSave: deathSaveSchema(),
      deathSaveResult: deathSaveSchema(),
      deathSaves: { type: 'object', additionalProperties: true },
      deathSaveSuccesses: { type: 'integer', minimum: 0, maximum: 3 },
      deathSaveFailures: { type: 'integer', minimum: 0, maximum: 3 },
      currentHp: { type: 'number' },
      hp: { type: 'number' },
      maxHp: { type: 'number' },
      currentTemporaryHp: { type: 'number' },
      temporaryHpBefore: { type: 'number' },
      tempHpBefore: { type: 'number' },
      applyDamageOnMiss: { type: 'boolean' },
      allowHealingDead: { type: 'boolean' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function targetSchema() {
  return {
    type: 'object',
    properties: {
      sceneId: { type: 'string' },
      npcId: { type: 'string' },
      playerId: { type: 'string' },
      actorId: { type: 'string' },
      id: { type: 'string' },
      name: { type: 'string' },
      actorType: { type: 'string' },
      type: { type: 'string' },
      isPlayer: { type: 'boolean' },
      player: { type: 'boolean' },
      protagonistId: { type: 'string' },
      hit: hitSchema(),
      attack: hitSchema(),
      outcome: {},
      damage: damageArraySchema(),
      damages: damageArraySchema(),
      damageRolls: damageArraySchema(),
      healing: healingArraySchema(),
      heals: healingArraySchema(),
      temporaryHp: temporaryHpSchema(),
      tempHp: temporaryHpSchema(),
      statusEffects: statusEffectArraySchema(),
      statuses: statusEffectArraySchema(),
      conditions: statusEffectArraySchema(),
      defenses: defenseSchema(),
      resistances: stringArraySchema(),
      vulnerabilities: stringArraySchema(),
      immunities: stringArraySchema(),
      concentration: { type: 'object', additionalProperties: true },
      concentrating: { type: 'boolean' },
      concentrationCheck: { type: 'object', additionalProperties: true },
      concentrationSave: { type: 'object', additionalProperties: true },
      deathSave: deathSaveSchema(),
      deathSaveResult: deathSaveSchema(),
      deathSaves: { type: 'object', additionalProperties: true },
      deathSaveSuccesses: { type: 'integer', minimum: 0, maximum: 3 },
      deathSaveFailures: { type: 'integer', minimum: 0, maximum: 3 },
      currentHp: { type: 'number' },
      hp: { type: 'number' },
      maxHp: { type: 'number' },
      currentTemporaryHp: { type: 'number' },
      temporaryHpBefore: { type: 'number' },
      tempHpBefore: { type: 'number' },
      applyDamageOnMiss: { type: 'boolean' },
      allowHealingDead: { type: 'boolean' },
      source: { type: 'string' }
    },
    additionalProperties: false
  };
}

function hitSchema() {
  return {
    oneOf: [
      { type: 'string' },
      { type: 'boolean' },
      {
        type: 'object',
        properties: {
          outcome: { type: 'string' },
          result: { type: 'string' },
          status: { type: 'string' },
          hit: { type: 'boolean' },
          miss: { type: 'boolean' },
          critical: { type: 'boolean' },
          source: { type: 'string' },
          margin: { type: 'number' }
        },
        additionalProperties: true
      }
    ]
  };
}

function damageArraySchema() {
  return {
    oneOf: [
      { type: 'number' },
      damageItemSchema(),
      {
        type: 'array',
        items: {
          oneOf: [
            { type: 'number' },
            damageItemSchema()
          ]
        }
      }
    ]
  };
}

function healingArraySchema() {
  return {
    oneOf: [
      { type: 'number' },
      healingItemSchema(),
      {
        type: 'array',
        items: {
          oneOf: [
            { type: 'number' },
            healingItemSchema()
          ]
        }
      }
    ]
  };
}

function damageItemSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      type: { type: 'string' },
      amount: { type: 'number' },
      total: { type: 'number' },
      rollTotal: { type: 'number' },
      roll: rollSchema(),
      tags: stringArraySchema(),
      magical: { type: 'boolean' },
      ignoreResistance: { type: 'boolean' },
      ignoreVulnerability: { type: 'boolean' },
      ignoreImmunity: { type: 'boolean' },
      note: { type: 'string' },
      description: { type: 'string' }
    },
    additionalProperties: true
  };
}

function healingItemSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      type: { type: 'string' },
      amount: { type: 'number' },
      total: { type: 'number' },
      rollTotal: { type: 'number' },
      roll: rollSchema(),
      note: { type: 'string' },
      description: { type: 'string' }
    },
    additionalProperties: true
  };
}

function rollSchema() {
  return {
    type: 'object',
    properties: {
      expression: { type: 'string' },
      dice: { type: 'string' },
      total: { type: 'number' },
      rollTotal: { type: 'number' },
      rolls: {
        type: 'array',
        items: { type: 'number' }
      },
      source: { type: 'string' }
    },
    additionalProperties: true
  };
}

function temporaryHpSchema() {
  return {
    oneOf: [
      { type: 'number' },
      {
        type: 'object',
        properties: {
          amount: { type: 'number' },
          value: { type: 'number' },
          total: { type: 'number' },
          mode: { type: 'string' },
          operation: { type: 'string' }
        },
        additionalProperties: true
      }
    ]
  };
}

function statusEffectArraySchema() {
  return {
    oneOf: [
      { type: 'string' },
      statusEffectSchema(),
      {
        type: 'array',
        items: {
          oneOf: [
            { type: 'string' },
            statusEffectSchema()
          ]
        }
      }
    ]
  };
}

function statusEffectSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      status: { type: 'string' },
      condition: { type: 'string' },
      conditionName: { type: 'string' },
      operation: { type: 'string' },
      mode: { type: 'string' },
      active: { type: 'boolean' },
      stacks: { type: 'number' },
      intensity: { type: 'number' },
      value: { type: 'number' },
      remainingTurns: { type: 'number' },
      duration: { type: 'number' },
      turns: { type: 'number' },
      source: { type: 'string' },
      description: { type: 'string' },
      text: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true },
      _delete: { type: 'boolean' }
    },
    additionalProperties: true
  };
}

function defenseSchema() {
  return {
    type: 'object',
    properties: {
      resistances: stringArraySchema(),
      resistance: stringArraySchema(),
      vulnerabilities: stringArraySchema(),
      vulnerability: stringArraySchema(),
      immunities: stringArraySchema(),
      immunity: stringArraySchema()
    },
    additionalProperties: true
  };
}

function deathSaveSchema() {
  return {
    oneOf: [
      { type: 'string' },
      {
        type: 'object',
        properties: {
          outcome: { type: 'string' },
          result: { type: 'string' },
          total: { type: 'number' },
          force: { type: 'boolean' }
        },
        additionalProperties: true
      }
    ]
  };
}

function stringArraySchema() {
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
