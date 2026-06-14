// @ts-nocheck
import { randomInt } from 'node:crypto';
import { createId } from '../utils/id.js';
import { selectCombatActionFromTable } from './combat-action-table.js';

export async function selectEnemyCombatAction({
  toolManager,
  input = {},
  getActorState
} = {}) {
  const chatSessionId = requireText(input.chatSessionId, 'chatSessionId');
  const sceneId = optionalText(input.sceneId) || 'current';
  const actorId = requireText(input.actorId || input.enemyId || input.npcId, 'actorId');
  const actorState = input.actorState || await getActorStateSafe({ toolManager, getActorState, chatSessionId, sceneId, actorId });
  const actor = actorState?.data || actorState || {};
  const explicitPolicy = input.normalActionPolicy || input.actionPolicy || input.actionTable || input.table;

  if (explicitPolicy) {
    return {
      ...selectCombatActionFromTable({
        table: explicitPolicy,
        actorId,
        roll: input.roll ?? input.selectionRoll
      }),
      actorId,
      actorState,
      candidates: [],
      mechanics: [],
      selectionSource: 'explicit_action_table'
    };
  }

  const fallbackPolicy = actor.resources?.combat?.normalActionPolicy
    || actor.resources?.combat?.actionPolicy
    || actor.normalActionPolicy
    || actor.actionPolicy;
  const mechanics = await collectActorMechanics({ toolManager, actor, input });
  const candidates = buildEnemyActionCandidates({
    actor,
    mechanics,
    input: {
      ...input,
      includeBasicAttack: input.includeBasicAttack ?? !fallbackPolicy
    }
  });
  if (candidates.length) {
    const selection = selectWeightedCandidate(candidates, input.roll ?? input.selectionRoll);
    return {
      actorId,
      actorState,
      candidates,
      mechanics,
      selected: {
        ...selection.selected,
        payload: selection.selected.payload
      },
      roll: selection.roll,
      ranges: selection.ranges,
      noLlm: true,
      selectionSource: 'actor_state_and_mechanics'
    };
  }

  const policySource = fallbackPolicy || { actorId };
  return {
    ...selectCombatActionFromTable({
      table: policySource,
      actorId,
      roll: input.roll ?? input.selectionRoll
    }),
    actorId,
    actorState,
    candidates: [],
    mechanics,
    selectionSource: 'fallback_action_table'
  };
}

export function buildEnemyActionCandidates({ actor = {}, mechanics = [], input = {} } = {}) {
  const directActions = [
    ...normalizeArray(actor.resources?.combat?.actions),
    ...normalizeArray(actor.resources?.combat?.actionOptions),
    ...normalizeArray(actor.skillBar?.actions),
    ...normalizeArray(actor.skillBar?.spells),
    ...normalizeArray(actor.statusBar?.specialSkills)
  ];
  const directCandidates = directActions
    .map((action) => actionToCandidate(action, {
      actor,
      mechanic: findMechanicForAction(action, mechanics),
      source: 'actor_state'
    }))
    .filter(Boolean);

  const mechanicCandidates = mechanics
    .map((mechanic) => mechanicToCandidate(mechanic, { actor, source: 'mechanics_registry' }))
    .filter(Boolean);

  const statusCandidates = normalizeArray(actor.specialStatuses)
    .filter((status) => status?.active !== false)
    .map((status) => {
      const mechanic = findMechanic(mechanics, 'status', status.id || status.name);
      const statusAction = nonEmptyObject(status.metadata?.combatAction || status.metadata?.action);
      const mechanicAction = nonEmptyObject(mechanic?.data?.metadata?.combatAction || mechanic?.data?.metadata?.action);
      if (!statusAction && !mechanicAction) return undefined;
      return actionToCandidate(statusAction, {
        actor,
        mechanic,
        source: 'active_status',
        fallbackId: status.id,
        fallbackName: status.name
      });
    })
    .filter(Boolean);

  const candidates = dedupeCandidates([
    ...directCandidates,
    ...mechanicCandidates,
    ...statusCandidates
  ]);
  if (input.includeBasicAttack !== false && !candidates.some((candidate) => candidate.mode === 'attack')) {
    candidates.push(basicAttackCandidate(actor));
  }
  return candidates.filter((candidate) => candidate.ready !== false && candidate.weight > 0);
}

export async function collectActorMechanics({ toolManager, actor = {}, input = {} } = {}) {
  if (!toolManager?.executeTool) return [];
  const refs = collectMechanicRefs(actor, input);
  const records = [];
  for (const ref of refs) {
    const toolId = mechanicGetTool(ref.kind);
    if (!toolId || !ref.id) continue;
    const result = await safeExecute(toolManager, toolId, { id: ref.id });
    if (result.ok) {
      records.push({
        kind: ref.kind,
        id: ref.id,
        source: ref.source,
        record: result.output,
        data: result.output?.data || result.output
      });
    }
  }
  return records;
}

function collectMechanicRefs(actor = {}, input = {}) {
  const refs = [];
  const push = (kind, id, source) => {
    const normalized = optionalText(id);
    if (!kind || !normalized) return;
    refs.push({ kind, id: normalized, source });
  };
  for (const action of [
    ...normalizeArray(actor.resources?.combat?.actions),
    ...normalizeArray(actor.resources?.combat?.actionOptions),
    ...normalizeArray(actor.skillBar?.actions),
    ...normalizeArray(actor.skillBar?.spells),
    ...normalizeArray(actor.statusBar?.specialSkills)
  ]) {
    push(action.mechanicKind || (action.featId ? 'feat' : action.statusId ? 'status' : action.skillId ? 'skill' : ''), action.mechanicId || action.skillId || action.featId || action.statusId, `action:${action.id || action.name || ''}`);
  }
  for (const skill of normalizeArray(actor.skillBar?.skills)) {
    push('skill', skill.skillId || skill.mechanicId || skill.registryId || prefixedRegistryId(skill.id, ['skill_', 'spell_']), 'skillBar.skills');
  }
  for (const skill of [
    ...normalizeArray(actor.resources?.combat?.skillIds),
    ...normalizeArray(actor.resources?.combat?.skills)
  ]) push('skill', typeof skill === 'string' ? skill : skill.skillId || skill.id, 'skill_refs');
  for (const feat of [
    ...normalizeArray(actor.skillBar?.feats),
    ...normalizeArray(actor.statusBar?.feats),
    ...normalizeArray(actor.resources?.combat?.featIds),
    ...normalizeArray(actor.resources?.combat?.feats)
  ]) push('feat', typeof feat === 'string' ? feat : feat.featId || feat.id, 'feat_refs');
  for (const status of normalizeArray(actor.specialStatuses)) {
    push('status', status.statusId || status.mechanicId || status.registryId || prefixedRegistryId(status.id, ['status_']), 'specialStatuses');
  }
  for (const status of [
    ...normalizeArray(actor.resources?.combat?.statusIds),
    ...normalizeArray(actor.resources?.combat?.statuses)
  ]) push('status', typeof status === 'string' ? status : status.statusId || status.id, 'status_refs');
  for (const ref of normalizeArray(input.mechanicRefs)) push(ref.kind, ref.id, 'input.mechanicRefs');

  const seen = new Set();
  return refs.filter((ref) => {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function prefixedRegistryId(value, prefixes = []) {
  const id = optionalText(value);
  return id && prefixes.some((prefix) => id.startsWith(prefix)) ? id : '';
}

function actionToCandidate(actionInput, { actor = {}, mechanic, source = 'actor_state', fallbackId, fallbackName } = {}) {
  const action = normalizeObject(actionInput);
  const mechanicAction = normalizeObject(mechanic?.data?.metadata?.combatAction || mechanic?.data?.metadata?.action);
  const numeric = normalizeObject(mechanic?.data?.numericValues || mechanic?.data?.values || mechanic?.data?.numericSettings);
  const merged = deepMerge(mechanicAction, action);
  const id = optionalText(merged.id || merged.actionId || fallbackId || mechanic?.id || mechanic?.record?.id);
  const name = optionalText(merged.name || merged.label || fallbackName || mechanic?.data?.name || id);
  if (!id && !name) return undefined;
  const mode = normalizeMode(merged.mode || merged.actionMode || merged.actionKind || merged.kind || merged.type || mechanicAction.mode || 'attack');
  const payload = payloadForMode(mode, merged, numeric, actor);
  return {
    actionId: safeSegment(id || name || createId('enemyaction')),
    name: name || id,
    mode,
    actionKind: mode === 'attack' ? optionalText(merged.actionKind || 'attack') : mode,
    weight: positiveNumber(merged.weight ?? numeric.weight ?? mechanicAction.weight ?? defaultWeight(mode)),
    ready: merged.ready !== false && merged.prepared !== false,
    source,
    mechanic: mechanic ? { kind: mechanic.kind, id: mechanic.id, name: mechanic.data?.name, source: mechanic.source } : undefined,
    payload
  };
}

function mechanicToCandidate(mechanic, { actor = {}, source = 'mechanics_registry' } = {}) {
  const action = nonEmptyObject(mechanic?.data?.metadata?.combatAction || mechanic?.data?.metadata?.action);
  const numeric = normalizeObject(mechanic?.data?.numericValues || mechanic?.data?.values || mechanic?.data?.numericSettings);
  if (!action && !numeric.combatWeight && !numeric.weight && !numeric.damageAmount && !numeric.acBonus && !numeric.temporaryHp) {
    return undefined;
  }
  return actionToCandidate({
    id: mechanic.id,
    name: mechanic.data?.name,
    ...(action || {}),
    weight: action?.weight ?? numeric.combatWeight ?? numeric.weight
  }, { actor, mechanic, source });
}

function basicAttackCandidate(actor = {}) {
  const values = normalizeObject(actor.values);
  return {
    actionId: 'basic_attack',
    name: 'Basic Attack',
    mode: 'attack',
    actionKind: 'attack',
    weight: 50,
    ready: true,
    source: 'default_basic_attack',
    payload: {
      mode: 'attack',
      targetPolicy: 'nearest_enemy',
      successThresholdPolicy: 'target_ac',
      diceCount: 1,
      diceSides: 20,
      modifier: numberOr(values.attackModifier, values.modifier, 0),
      criticalMode: 'd20',
      damage: [{ type: 'damage', amount: numberOr(values.damageAmount, 1) }],
      damageRolls: [],
      resourceCosts: []
    }
  };
}

function payloadForMode(mode, action = {}, numeric = {}, actor = {}) {
  if (mode === 'defense') {
    return {
      mode: 'defense',
      targetPolicy: 'self',
      acBonus: numberOr(action.acBonus, action.defenseBonus, numeric.acBonus, numeric.defenseBonus, 0),
      temporaryHp: numberOr(action.temporaryHp, action.tempHp, numeric.temporaryHp, numeric.tempHp, 0),
      damageReduction: numberOr(action.damageReduction, numeric.damageReduction, 0),
      durationRounds: numberOr(action.durationRounds, action.rounds, numeric.durationRounds, 1),
      statusEffects: normalizeArray(action.statusEffects || action.statuses),
      resourceCosts: normalizeArray(action.resourceCosts || action.costs)
    };
  }
  if (mode === 'dodge') {
    return {
      mode: 'dodge',
      targetPolicy: 'self',
      acBonus: numberOr(action.acBonus, action.dodgeBonus, numeric.acBonus, numeric.dodgeBonus, 2),
      incomingAttackDisadvantage: action.incomingAttackDisadvantage !== false,
      dexSaveAdvantage: action.dexSaveAdvantage !== false,
      durationRounds: numberOr(action.durationRounds, action.rounds, numeric.durationRounds, 1),
      statusEffects: normalizeArray(action.statusEffects || action.statuses),
      resourceCosts: normalizeArray(action.resourceCosts || action.costs)
    };
  }
  const values = normalizeObject(actor.values);
  return {
    mode: 'attack',
    targetPolicy: optionalText(action.targetPolicy) || 'nearest_enemy',
    successThresholdPolicy: optionalText(action.successThresholdPolicy) || 'target_ac',
    successThreshold: action.successThreshold ?? action.dc ?? action.targetAc,
    diceCount: numberOr(action.diceCount, action.rollCount, numeric.diceCount, 1),
    diceSides: numberOr(action.diceSides, action.sides, numeric.diceSides, 20),
    modifier: numberOr(action.modifier, action.attackModifier, numeric.attackModifier, values.attackModifier, 0),
    forceMode: optionalText(action.forceMode),
    rollMode: optionalText(action.rollMode),
    inspirationPoints: action.inspirationPoints,
    criticalMode: optionalText(action.criticalMode || 'd20'),
    damage: normalizeDamage(action.damage, numeric),
    damageRolls: normalizeArray(action.damageRolls || action.damageDice),
    criticalDamageMultiplier: numberOr(action.criticalDamageMultiplier, numeric.criticalDamageMultiplier, 2),
    applyDamageOnMiss: action.applyDamageOnMiss === true,
    resourceCosts: normalizeArray(action.resourceCosts || action.costs)
  };
}

function selectWeightedCandidate(candidates, suppliedRoll) {
  const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0) || 1;
  const roll = normalizeUnitRoll(suppliedRoll);
  let cursor = 0;
  const ranges = {};
  let selected = candidates[0];
  for (const candidate of candidates) {
    const start = cursor / total;
    cursor += candidate.weight;
    const end = cursor / total;
    ranges[candidate.actionId] = { start, end };
    if (roll >= start && roll < end) {
      selected = candidate;
    }
  }
  return { selected, roll, ranges };
}

function findMechanicForAction(action = {}, mechanics = []) {
  const kind = action.mechanicKind || (action.featId ? 'feat' : action.statusId ? 'status' : action.skillId ? 'skill' : undefined);
  const id = action.mechanicId || action.skillId || action.featId || action.statusId;
  return kind && id ? findMechanic(mechanics, kind, id) : undefined;
}

function findMechanic(mechanics = [], kind, id) {
  const normalizedId = optionalText(id);
  return mechanics.find((item) => item.kind === kind && (item.id === normalizedId || item.record?.id === normalizedId || item.data?.id === normalizedId));
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = candidate.actionId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getActorStateSafe({ toolManager, getActorState, chatSessionId, sceneId, actorId }) {
  if (getActorState) return getActorState({ chatSessionId, sceneId, actorId });
  const result = await safeExecute(toolManager, 'system.npc_state.get_state', { chatSessionId, sceneId, npcId: actorId });
  return result.ok ? result.output : undefined;
}

async function safeExecute(toolManager, toolId, input) {
  try {
    const result = await toolManager.executeTool(toolId, input);
    return { ok: true, output: result.output, result };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
}

function mechanicGetTool(kind) {
  if (kind === 'skill') return 'system.mechanics_registry.get_skill';
  if (kind === 'feat') return 'system.mechanics_registry.get_feat';
  if (kind === 'status') return 'system.mechanics_registry.get_status';
  return '';
}

function normalizeDamage(damage, numeric = {}) {
  const supplied = normalizeArray(damage);
  if (supplied.length) return supplied;
  const amount = numberOr(numeric.damageAmount, numeric.damage, numeric.value, undefined);
  if (amount !== undefined) return [{ type: optionalText(numeric.damageType) || 'damage', amount }];
  return [];
}

function normalizeMode(value) {
  const normalized = optionalText(value).toLowerCase();
  if (['defend', 'guard', 'block', 'defense'].includes(normalized)) return 'defense';
  if (['evade', 'avoid', 'dodge'].includes(normalized)) return 'dodge';
  return 'attack';
}

function defaultWeight(mode) {
  if (mode === 'defense') return 25;
  if (mode === 'dodge') return 15;
  return 60;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 1;
}

function numberOr(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function normalizeUnitRoll(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return randomInt(0, 1_000_000) / 1_000_000;
  return Math.max(0, Math.min(0.999999999, number));
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nonEmptyObject(value) {
  const object = normalizeObject(value);
  return Object.keys(object).length ? object : undefined;
}

function deepMerge(base = {}, override = {}) {
  const result = { ...normalizeObject(base), ...normalizeObject(override) };
  for (const key of ['attack', 'defense', 'dodge', 'metadata']) {
    if (base?.[key] && override?.[key]) result[key] = { ...normalizeObject(base[key]), ...normalizeObject(override[key]) };
  }
  return result;
}

function safeSegment(value) {
  return optionalText(value).replace(/[^A-Za-z0-9_.:-]+/g, '_') || createId('enemyaction');
}

function optionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function requireText(value, name) {
  const text = optionalText(value);
  if (!text) throw validationError(`${name} is required`);
  return text;
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'EnemyActionSelectionError';
  error.statusCode = 400;
  return error;
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    statusCode: error?.statusCode,
    details: error?.details
  };
}
