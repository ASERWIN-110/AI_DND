// @ts-nocheck
import { randomInt } from 'node:crypto';
import { createId } from '../utils/id.js';

export const COMBAT_ACTION_MODES = ['attack', 'defense', 'dodge'];

export const COMBAT_ACTION_TABLE_REFERENCE = {
  version: 'combat_action_table_v1',
  purpose: 'Hidden enemy action policy for standalone combat UI. It chooses only attack, defense, or dodge; no visible skill names are needed.',
  allowedModes: COMBAT_ACTION_MODES,
  designRules: [
    'Use the enemy setting, threat tier, current scene, and target situation to assign numeric weights.',
    'Do not invent named skills for this table. The UI only needs the mode: attack, defense, or dodge.',
    'Normal turns use this table without LLM. LLM is only for creating the table, special requests, and aftermath.',
    'Ancient/cosmic enemies should have larger numeric modifiers and effects, but still output the same three modes.'
  ],
  threatReference: [
    {
      tier: 'minion',
      description: 'Weak disposable foe.',
      weights: { attack: 65, defense: 15, dodge: 20 },
      attack: { modifier: 2, damageDice: '1d4+1' },
      defense: { acBonus: 1, temporaryHp: 1, durationRounds: 1 },
      dodge: { acBonus: 2, durationRounds: 1 }
    },
    {
      tier: 'trained',
      description: 'Ordinary armed opponent.',
      weights: { attack: 60, defense: 25, dodge: 15 },
      attack: { modifier: 4, damageDice: '1d6+2' },
      defense: { acBonus: 2, temporaryHp: 3, durationRounds: 1 },
      dodge: { acBonus: 3, durationRounds: 1 }
    },
    {
      tier: 'elite',
      description: 'Dangerous named fighter or monster.',
      weights: { attack: 70, defense: 20, dodge: 10 },
      attack: { modifier: 7, damageDice: '2d8+4' },
      defense: { acBonus: 3, temporaryHp: 8, durationRounds: 1 },
      dodge: { acBonus: 4, durationRounds: 1 }
    },
    {
      tier: 'boss',
      description: 'Major encounter opponent.',
      weights: { attack: 75, defense: 20, dodge: 5 },
      attack: { modifier: 10, damageDice: '3d10+6' },
      defense: { acBonus: 4, temporaryHp: 18, durationRounds: 1 },
      dodge: { acBonus: 5, durationRounds: 1 }
    },
    {
      tier: 'ancient_god',
      description: 'Reality-scale threat. Numbers are intentionally extreme but still debuggable.',
      weights: { attack: 80, defense: 18, dodge: 2 },
      attack: { modifier: 18, damageDice: '8d12+20' },
      defense: { acBonus: 8, temporaryHp: 80, durationRounds: 1 },
      dodge: { acBonus: 10, durationRounds: 1 }
    }
  ],
  fields: {
    weights: 'Relative probabilities. They do not need to sum to 100; the selector normalizes them.',
    attack: 'Numeric attack payload used later by combat.resolve_action.',
    defense: 'Self-protection payload. Typically temporary HP, AC bonus, or damage reduction for a short duration.',
    dodge: 'Avoidance payload. Typically AC bonus / incoming attack disadvantage / dexterity-save advantage for a short duration.',
    targetPolicy: 'UI/selector hint, e.g. nearest_enemy, lowest_hp_enemy, highest_threat_enemy, self.'
  }
};

export const COMBAT_ACTION_TABLE_TEMPLATE = {
  actionTableId: 'combat_table_debug_template',
  actorId: 'enemy_id',
  threatTier: 'trained',
  source: 'llm_opening_model | user | template | database',
  weights: {
    attack: 60,
    defense: 25,
    dodge: 15
  },
  attack: {
    targetPolicy: 'nearest_enemy',
    successThresholdPolicy: 'target_ac',
    modifier: 4,
    damageRolls: [
      { type: 'physical', diceCount: 1, diceSides: 6, modifier: 2 }
    ],
    criticalDamageMultiplier: 2
  },
  defense: {
    targetPolicy: 'self',
    acBonus: 2,
    temporaryHp: 3,
    damageReduction: 0,
    durationRounds: 1
  },
  dodge: {
    targetPolicy: 'self',
    acBonus: 3,
    incomingAttackDisadvantage: true,
    dexSaveAdvantage: true,
    durationRounds: 1
  },
  notes: 'Debug-only notes. Do not display as a skill name.'
};

export function buildCombatActionTablePrompt({
  enemy = {},
  actor = {},
  settingText = '',
  text = '',
  sourceText = '',
  context = {},
  userReference = '',
  reference = COMBAT_ACTION_TABLE_REFERENCE,
  template = COMBAT_ACTION_TABLE_TEMPLATE
} = {}) {
  return [
    'Create a hidden RPG combat action table for one opponent.',
    'The table is for an independent combat UI. It must choose only among attack, defense, and dodge.',
    'Do not create named skills, spell names, cinematic move names, or dialogue lines.',
    'Use the enemy setting to assign numeric weights and payloads. The enemy can be anything from a weak minion to an ancient god.',
    'Return JSON only.',
    userReference ? `User numeric reference:\n${userReference}` : '',
    'Enemy / actor setting:',
    JSON.stringify({ enemy, actor, settingText: settingText || text || sourceText }, null, 2),
    'Current combat context:',
    JSON.stringify(context || {}, null, 2),
    'Reference:',
    JSON.stringify(reference, null, 2),
    'Return one JSON object using this shape:',
    JSON.stringify(template, null, 2)
  ].filter(Boolean).join('\n\n');
}

export function normalizeCombatActionTable(input = {}, { actorId } = {}) {
  const source = normalizeObject(input.table || input.actionTable || input);
  const resolvedActorId = normalizeOptionalText(source.actorId || source.npcId || source.enemyId || actorId) || 'unknown_actor';
  const weights = normalizeWeights(source);
  return {
    actionTableId: safeSegment(source.actionTableId || source.tableId || source.id || createId('combattable')),
    actorId: resolvedActorId,
    threatTier: normalizeOptionalText(source.threatTier || source.tier || source.rank) || 'custom',
    source: normalizeOptionalText(source.source) || 'normalized',
    weights,
    probabilities: weightsToProbabilities(weights),
    attack: normalizeAttackPayload(source.attack || findAction(source, 'attack')),
    defense: normalizeDefensePayload(source.defense || findAction(source, 'defense')),
    dodge: normalizeDodgePayload(source.dodge || findAction(source, 'dodge')),
    notes: normalizeOptionalText(source.notes || source.debugNotes),
    metadata: normalizeObject(source.metadata)
  };
}

export function selectCombatActionFromTable(input = {}, { roll, random = secureRandomUnit } = {}) {
  const table = normalizeCombatActionTable(input.table || input.actionTable || input, {
    actorId: input.actorId || input.npcId || input.enemyId
  });
  const safeRoll = normalizeUnitRoll(roll ?? input.roll ?? input.selectionRoll ?? random());
  const total = COMBAT_ACTION_MODES.reduce((sum, mode) => sum + table.weights[mode], 0);
  let cursor = 0;
  let selectedMode = 'attack';
  const ranges = {};
  for (const mode of COMBAT_ACTION_MODES) {
    const start = cursor / total;
    cursor += table.weights[mode];
    const end = cursor / total;
    ranges[mode] = { start, end };
    if (safeRoll >= start && safeRoll < end) {
      selectedMode = mode;
      break;
    }
  }
  if (safeRoll >= 1) selectedMode = COMBAT_ACTION_MODES[COMBAT_ACTION_MODES.length - 1];
  return {
    actionTable: table,
    selected: {
      mode: selectedMode,
      weight: table.weights[selectedMode],
      probability: table.probabilities[selectedMode],
      payload: table[selectedMode]
    },
    roll: safeRoll,
    ranges,
    noLlm: true
  };
}

function normalizeWeights(source) {
  const fromActions = Object.fromEntries(COMBAT_ACTION_MODES.map((mode) => [mode, findAction(source, mode)?.weight]));
  const raw = {
    attack: source.weights?.attack ?? source.attackWeight ?? fromActions.attack,
    defense: source.weights?.defense ?? source.defenseWeight ?? fromActions.defense,
    dodge: source.weights?.dodge ?? source.dodgeWeight ?? fromActions.dodge
  };
  const weights = Object.fromEntries(COMBAT_ACTION_MODES.map((mode) => [
    mode,
    clampNumber(raw[mode] ?? (mode === 'attack' ? 60 : mode === 'defense' ? 25 : 15), 0, 10000)
  ]));
  if (COMBAT_ACTION_MODES.every((mode) => weights[mode] <= 0)) {
    return { attack: 60, defense: 25, dodge: 15 };
  }
  return weights;
}

function weightsToProbabilities(weights) {
  const total = COMBAT_ACTION_MODES.reduce((sum, mode) => sum + weights[mode], 0) || 1;
  return Object.fromEntries(COMBAT_ACTION_MODES.map((mode) => [mode, weights[mode] / total]));
}

function findAction(source, mode) {
  const actions = Array.isArray(source.actions) ? source.actions : [];
  return actions.find((action) => normalizeMode(action.mode || action.type || action.kind || action.id) === mode);
}

function normalizeAttackPayload(input = {}) {
  const source = normalizeObject(input);
  const fixedDamage = normalizeArray(source.damage);
  return {
    mode: 'attack',
    targetPolicy: normalizeOptionalText(source.targetPolicy) || 'nearest_enemy',
    successThresholdPolicy: normalizeOptionalText(source.successThresholdPolicy) || 'target_ac',
    successThreshold: source.successThreshold ?? source.dc ?? source.targetAc,
    diceCount: clampInteger(source.diceCount ?? source.rollCount ?? 1, 1, 1000),
    diceSides: clampInteger(source.diceSides ?? source.sides ?? 20, 2, 10000),
    modifier: normalizeInteger(source.modifier ?? source.attackModifier ?? 0, 'attack.modifier'),
    forceMode: normalizeOptionalText(source.forceMode),
    rollMode: normalizeOptionalText(source.rollMode),
    inspirationPoints: source.inspirationPoints,
    criticalMode: normalizeOptionalText(source.criticalMode || 'd20'),
    damage: fixedDamage,
    damageRolls: normalizeDamageRolls(source.damageRolls || source.damageDice || source.damageDicePool, {
      defaultIfEmpty: fixedDamage.length === 0
    }),
    criticalDamageMultiplier: clampNumber(source.criticalDamageMultiplier ?? 2, 1, 100),
    applyDamageOnMiss: source.applyDamageOnMiss === true,
    resourceCosts: normalizeArray(source.resourceCosts || source.costs).map(normalizeObject),
    metadata: normalizeObject(source.metadata)
  };
}

function normalizeDefensePayload(input = {}) {
  const source = normalizeObject(input);
  return {
    mode: 'defense',
    targetPolicy: 'self',
    acBonus: normalizeInteger(source.acBonus ?? source.defenseBonus ?? 0, 'defense.acBonus'),
    temporaryHp: clampNumber(source.temporaryHp ?? source.tempHp ?? 0, 0, 1000000),
    damageReduction: clampNumber(source.damageReduction ?? source.reduction ?? 0, 0, 1000000),
    durationRounds: clampInteger(source.durationRounds ?? source.rounds ?? 1, 0, 1000),
    resourceCosts: normalizeArray(source.resourceCosts || source.costs).map(normalizeObject),
    statusEffects: normalizeArray(source.statusEffects || source.statuses).map(normalizeObject),
    metadata: normalizeObject(source.metadata)
  };
}

function normalizeDodgePayload(input = {}) {
  const source = normalizeObject(input);
  return {
    mode: 'dodge',
    targetPolicy: 'self',
    acBonus: normalizeInteger(source.acBonus ?? source.dodgeBonus ?? 2, 'dodge.acBonus'),
    incomingAttackDisadvantage: source.incomingAttackDisadvantage !== false,
    dexSaveAdvantage: source.dexSaveAdvantage !== false,
    durationRounds: clampInteger(source.durationRounds ?? source.rounds ?? 1, 0, 1000),
    resourceCosts: normalizeArray(source.resourceCosts || source.costs).map(normalizeObject),
    statusEffects: normalizeArray(source.statusEffects || source.statuses).map(normalizeObject),
    metadata: normalizeObject(source.metadata)
  };
}

function normalizeDamageRolls(input = [], { defaultIfEmpty = true } = {}) {
  const rolls = normalizeArray(input)
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      type: normalizeOptionalText(item.type || item.damageType) || 'damage',
      diceCount: clampInteger(item.diceCount ?? item.count ?? 1, 1, 1000),
      diceSides: clampInteger(item.diceSides ?? item.sides ?? 4, 2, 10000),
      modifier: normalizeInteger(item.modifier ?? 0, 'damageRoll.modifier')
    }));
  return rolls.length || !defaultIfEmpty ? rolls : [{ type: 'damage', diceCount: 1, diceSides: 4, modifier: 0 }];
}

function normalizeMode(value) {
  const normalized = normalizeOptionalText(value).toLowerCase();
  if (['defend', 'guard', 'block', 'defense'].includes(normalized)) return 'defense';
  if (['evade', 'avoid', 'dodge'].includes(normalized)) return 'dodge';
  if (['attack', 'strike', 'hit'].includes(normalized)) return 'attack';
  return normalized;
}

function normalizeUnitRoll(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return secureRandomUnit();
  return Math.max(0, Math.min(0.999999999, number));
}

function secureRandomUnit() {
  return randomInt(0, 1_000_000) / 1_000_000;
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeInteger(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw validationError(`${name} must be a finite number`);
  return Math.trunc(number);
}

function clampInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function safeSegment(value) {
  return normalizeOptionalText(value)
    .replace(/[^A-Za-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 160) || createId('combattable');
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'CombatActionTableValidationError';
  error.statusCode = 400;
  return error;
}
