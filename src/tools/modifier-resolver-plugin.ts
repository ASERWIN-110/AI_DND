// @ts-nocheck
import { ModifierResolver } from '../mechanics/modifier-resolver.js';

export const MODIFIER_RESOLVER_PLUGIN = {
  id: 'system.modifiers',
  name: 'Modifier Resolver Tools',
  version: '0.1.0',
  description: 'Read-only deterministic resolver for buffs, debuffs, passive modifiers, AC changes, roll modes, and damage defenses.',
  enabled: true,
  permissions: ['modifiers:read'],
  metadata: {
    llm: false,
    mutatesState: false,
    scope: 'chat-session'
  },
  tools: [
    tool('describe_resolver', 'Describe Modifier Resolver', 'Describe how temporary buffs/debuffs and passive modifiers are resolved before dice and damage.', emptySchema(), ['modifiers', 'schema', 'no-llm']),
    tool('resolve_check_modifiers', 'Resolve Check Modifiers', 'Resolve actor/target modifiers for one attack, skill check, ability check, save, or generic dice check.', checkSchema(), ['modifiers', 'dice', 'check', 'no-llm']),
    tool('resolve_combat_modifiers', 'Resolve Combat Modifiers', 'Resolve combat-facing modifiers such as attack bonus, AC bonus, advantage/disadvantage, and passive mechanics.', checkSchema(), ['modifiers', 'combat', 'no-llm']),
    tool('resolve_damage_defenses', 'Resolve Damage Defenses', 'Resolve target resistance, vulnerability, and immunity from Actor state, statuses, equipment, and mechanics.', defenseSchema(), ['modifiers', 'damage', 'defenses', 'no-llm'])
  ]
};

export function createModifierResolverHandlers({ toolManager, resolver } = {}) {
  const modifiers = resolver || new ModifierResolver({ toolManager });
  return {
    describe_resolver: async () => modifiers.describe(),
    resolve_check_modifiers: async ({ input }) => modifiers.resolveCheckModifiers(input),
    resolve_combat_modifiers: async ({ input }) => modifiers.resolveCombatModifiers(input),
    resolve_damage_defenses: async ({ input }) => modifiers.resolveDamageDefenses(input)
  };
}

function tool(name, title, description, inputSchema, tags) {
  return {
    name,
    title,
    description,
    inputSchema,
    visibility: 'public',
    autoCallable: true,
    mutatesState: false,
    metadata: {
      noLlm: true,
      deterministic: true,
      scope: 'chat-session'
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

function checkSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      chatId: { type: 'string' },
      sessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      actorId: { type: 'string' },
      npcId: { type: 'string' },
      playerId: { type: 'string' },
      attackerId: { type: 'string' },
      targetId: { type: 'string' },
      targetNpcId: { type: 'string' },
      defenderId: { type: 'string' },
      targetIds: stringArraySchema(),
      actor: { type: 'object', additionalProperties: true },
      actorState: { type: 'object', additionalProperties: true },
      target: { type: 'object', additionalProperties: true },
      targetState: { type: 'object', additionalProperties: true },
      checkKind: { type: 'string' },
      kind: { type: 'string' },
      actionKind: { type: 'string' },
      type: { type: 'string' },
      actionId: { type: 'string' },
      ability: { type: 'string' },
      attribute: { type: 'string' },
      stat: { type: 'string' },
      skillId: { type: 'string' },
      skill: { type: 'string' },
      proficiency: { type: 'string' },
      save: { type: 'string' },
      savingThrow: { type: 'string' },
      damageType: { type: 'string' },
      damageTypes: stringArraySchema(),
      damage: { type: 'array', items: { type: 'object', additionalProperties: true } },
      damageRolls: { type: 'array', items: { type: 'object', additionalProperties: true } },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      base: { type: 'object', additionalProperties: true },
      diceInput: { type: 'object', additionalProperties: true },
      check: { type: 'object', additionalProperties: true },
      attack: { type: 'object', additionalProperties: true },
      successThresholdLocked: { type: 'boolean' },
      lockSuccessThreshold: { type: 'boolean' },
      lockedDc: { type: 'boolean' },
      includeMechanics: { type: 'boolean', default: true }
    },
    additionalProperties: true
  };
}

function defenseSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      chatId: { type: 'string' },
      sessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      targetId: { type: 'string' },
      targetNpcId: { type: 'string' },
      npcId: { type: 'string' },
      actorId: { type: 'string' },
      id: { type: 'string' },
      target: { type: 'object', additionalProperties: true },
      targetState: { type: 'object', additionalProperties: true },
      actor: { type: 'object', additionalProperties: true },
      damageType: { type: 'string' },
      damageTypes: stringArraySchema(),
      damage: { type: 'array', items: { type: 'object', additionalProperties: true } },
      damageRolls: { type: 'array', items: { type: 'object', additionalProperties: true } },
      includeMechanics: { type: 'boolean', default: true }
    },
    additionalProperties: true
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
