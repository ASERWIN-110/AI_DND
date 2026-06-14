// @ts-nocheck
import { randomInt as cryptoRandomInt } from 'node:crypto';

const DEFAULT_CHECK = {
  successThreshold: 10,
  diceCount: 1,
  diceSides: 20,
  modifier: 0,
  abilityModifier: 0,
  proficiencyBonus: 0,
  forceMode: 'normal',
  rollMode: 'normal',
  inspirationPoints: 0,
  criticalMode: 'd20'
};

const OUTCOMES = new Set(['success', 'failure', 'criticalSuccess', 'criticalFailure']);
const FORCE_MODES = new Set(['normal', 'success', 'failure', 'criticalSuccess', 'criticalFailure']);
const ROLL_MODES = new Set(['normal', 'advantage', 'disadvantage']);
const CRITICAL_MODES = new Set(['none', 'd20', 'maxTotal', 'minTotal']);

export class DiceEngine {
  constructor({ randomInt = secureRandomInt } = {}) {
    this.randomInt = randomInt;
  }

  check(input = {}) {
    return runDiceCheck(input, { randomInt: this.randomInt });
  }
}

export function runDiceCheck(input = {}, { randomInt = secureRandomInt } = {}) {
  const config = normalizeDiceCheckInput(input);
  const modifierBreakdown = buildModifierBreakdown(config);
  const modifierTotal = modifierBreakdown.reduce((sum, item) => sum + item.value, 0);
  const attempts = [];
  const maxAttempts = 1 + config.inspirationPoints;

  for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
    const attempt = rollAttempt(config, modifierTotal, randomInt, attemptIndex + 1);
    attempts.push(attempt);

    if (config.forceMode !== 'normal') break;
    if (attempt.success) break;
  }

  const selectedAttempt = selectAttempt(attempts, config);
  const forcedOutcome = forceOutcome(config.forceMode);
  const outcome = forcedOutcome || selectedAttempt.outcome;

  return {
    outcome,
    success: outcome === 'success' || outcome === 'criticalSuccess',
    failure: outcome === 'failure' || outcome === 'criticalFailure',
    critical: outcome === 'criticalSuccess' || outcome === 'criticalFailure',
    criticalSuccess: outcome === 'criticalSuccess',
    criticalFailure: outcome === 'criticalFailure',
    forced: config.forceMode !== 'normal',
    forceMode: config.forceMode,
    successThreshold: config.successThreshold,
    dice: {
      count: config.diceCount,
      sides: config.diceSides,
      expression: `${config.diceCount}d${config.diceSides}${formatSigned(modifierTotal)}`
    },
    rollMode: config.rollMode,
    criticalMode: config.criticalMode,
    inspiration: {
      available: config.inspirationPoints,
      used: Math.max(0, attempts.length - 1)
    },
    modifierTotal,
    modifierBreakdown,
    rolls: selectedAttempt.rolls,
    naturalTotal: selectedAttempt.naturalTotal,
    total: selectedAttempt.total,
    selectedAttempt,
    attempts
  };
}

export function normalizeDiceCheckInput(input = {}) {
  const config = {
    ...DEFAULT_CHECK,
    ...input,
    successThreshold: Number(input.successThreshold ?? input.dc ?? input.target ?? DEFAULT_CHECK.successThreshold),
    diceCount: Number(input.diceCount ?? input.rollCount ?? input.count ?? DEFAULT_CHECK.diceCount),
    diceSides: Number(input.diceSides ?? input.sides ?? DEFAULT_CHECK.diceSides),
    modifier: Number(input.modifier ?? input.fixedModifier ?? 0),
    buff: Number(input.buff ?? 0),
    debuff: Number(input.debuff ?? 0),
    abilityModifier: Number(input.abilityModifier ?? 0),
    proficiencyBonus: Number(input.proficiencyBonus ?? 0),
    inspirationPoints: Number(input.inspirationPoints ?? input.inspirationRerolls ?? 0),
    forceMode: input.forceMode || input.force || DEFAULT_CHECK.forceMode,
    rollMode: input.rollMode || DEFAULT_CHECK.rollMode,
    criticalMode: input.criticalMode || DEFAULT_CHECK.criticalMode,
    modifiers: Array.isArray(input.modifiers) ? input.modifiers : []
  };

  assertInteger(config.successThreshold, 'successThreshold', -100000, 100000);
  assertInteger(config.diceCount, 'diceCount', 1, 100);
  assertInteger(config.diceSides, 'diceSides', 2, 10000);
  assertInteger(config.modifier, 'modifier', -100000, 100000);
  assertInteger(config.buff, 'buff', -100000, 100000);
  assertInteger(config.debuff, 'debuff', -100000, 100000);
  assertInteger(config.abilityModifier, 'abilityModifier', -100000, 100000);
  assertInteger(config.proficiencyBonus, 'proficiencyBonus', -100000, 100000);
  assertInteger(config.inspirationPoints, 'inspirationPoints', 0, 20);

  if (!FORCE_MODES.has(config.forceMode)) {
    throw validationError(`forceMode must be one of: ${[...FORCE_MODES].join(', ')}`);
  }
  if (!ROLL_MODES.has(config.rollMode)) {
    throw validationError(`rollMode must be one of: ${[...ROLL_MODES].join(', ')}`);
  }
  if (!CRITICAL_MODES.has(config.criticalMode)) {
    throw validationError(`criticalMode must be one of: ${[...CRITICAL_MODES].join(', ')}`);
  }

  return config;
}

function rollAttempt(config, modifierTotal, randomInt, attemptNumber) {
  const candidates = buildRollCandidates(config, randomInt);
  const selected = selectRollCandidate(candidates, config.rollMode);
  const naturalTotal = selected.rolls.reduce((sum, value) => sum + value, 0);
  const total = naturalTotal + modifierTotal;
  const naturalOutcome = getCriticalOutcome(config, selected.rolls, naturalTotal);
  const thresholdOutcome = total >= config.successThreshold ? 'success' : 'failure';
  const outcome = naturalOutcome || thresholdOutcome;

  return {
    attempt: attemptNumber,
    candidates,
    selectedCandidateIndex: selected.index,
    rolls: selected.rolls,
    naturalTotal,
    modifierTotal,
    total,
    outcome,
    success: outcome === 'success' || outcome === 'criticalSuccess',
    failure: outcome === 'failure' || outcome === 'criticalFailure',
    critical: outcome === 'criticalSuccess' || outcome === 'criticalFailure'
  };
}

function buildRollCandidates(config, randomInt) {
  const candidateCount = config.rollMode === 'normal' ? 1 : 2;
  const candidates = [];

  for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
    const rolls = [];
    for (let rollIndex = 0; rollIndex < config.diceCount; rollIndex += 1) {
      rolls.push(randomInt(1, config.diceSides));
    }
    candidates.push({
      index: candidateIndex,
      rolls,
      naturalTotal: rolls.reduce((sum, value) => sum + value, 0)
    });
  }

  return candidates;
}

function selectRollCandidate(candidates, rollMode) {
  if (rollMode === 'advantage') {
    return candidates.reduce((best, candidate) => (
      candidate.naturalTotal > best.naturalTotal ? candidate : best
    ));
  }

  if (rollMode === 'disadvantage') {
    return candidates.reduce((worst, candidate) => (
      candidate.naturalTotal < worst.naturalTotal ? candidate : worst
    ));
  }

  return candidates[0];
}

function selectAttempt(attempts, config) {
  if (config.forceMode !== 'normal') {
    return attempts[0];
  }

  const criticalSuccess = attempts.find((attempt) => attempt.outcome === 'criticalSuccess');
  if (criticalSuccess) return criticalSuccess;

  const success = attempts.find((attempt) => attempt.success);
  if (success) return success;

  return attempts.reduce((best, attempt) => (
    attempt.total > best.total ? attempt : best
  ));
}

function getCriticalOutcome(config, rolls, naturalTotal) {
  if (config.criticalMode === 'none') return undefined;

  if (config.criticalMode === 'd20') {
    if (config.diceCount !== 1 || config.diceSides !== 20) return undefined;
    if (rolls[0] === 20) return 'criticalSuccess';
    if (rolls[0] === 1) return 'criticalFailure';
    return undefined;
  }

  if (config.criticalMode === 'maxTotal') {
    if (naturalTotal === config.diceCount * config.diceSides) return 'criticalSuccess';
    if (naturalTotal === config.diceCount) return 'criticalFailure';
  }

  if (config.criticalMode === 'minTotal') {
    if (naturalTotal === config.diceCount) return 'criticalFailure';
  }

  return undefined;
}

function forceOutcome(forceMode) {
  if (forceMode === 'normal') return undefined;
  if (OUTCOMES.has(forceMode)) return forceMode;
  return forceMode;
}

function buildModifierBreakdown(config) {
  const modifiers = [
    { name: 'fixed', value: config.modifier },
    { name: 'buff', value: config.buff },
    { name: 'debuff', value: -config.debuff },
    { name: 'ability', value: config.abilityModifier },
    { name: 'proficiency', value: config.proficiencyBonus },
    ...config.modifiers.map((modifier, index) => ({
      name: String(modifier.name || `modifier_${index + 1}`),
      value: Number(modifier.value || 0)
    }))
  ];

  for (const modifier of modifiers) {
    assertInteger(modifier.value, `modifier.${modifier.name}`, -100000, 100000);
  }

  return modifiers.filter((modifier) => modifier.value !== 0);
}

function secureRandomInt(minInclusive, maxInclusive) {
  return cryptoRandomInt(minInclusive, maxInclusive + 1);
}

function assertInteger(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw validationError(`${name} must be an integer between ${min} and ${max}`);
  }
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'DiceValidationError';
  error.statusCode = 400;
  return error;
}

function formatSigned(value) {
  if (value === 0) return '';
  return value > 0 ? `+${value}` : String(value);
}
