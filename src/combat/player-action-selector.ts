// @ts-nocheck
import { createId } from '../utils/id.js';

export async function listPlayerCombatActions({
  toolManager,
  input = {}
} = {}) {
  const chatSessionId = requireText(input.chatSessionId, 'chatSessionId');
  const sceneId = optionalText(input.sceneId) || 'current';
  const actorId = requireText(input.actorId || input.playerId || input.npcId, 'actorId');
  const actorState = input.actorState || await getActorState({ toolManager, chatSessionId, sceneId, actorId });
  const actor = actorState?.data || actorState || {};
  const mechanics = await collectPlayerMechanics({ toolManager, actor, input });
  const choices = buildPlayerActionChoices({
    actor,
    mechanics,
    input: { ...input, chatSessionId, sceneId, actorId }
  });
  return {
    actor: compactActor(actorState),
    choices,
    mechanics,
    selectedActionId: optionalText(input.selectedActionId || input.actionChoiceId || input.choiceId),
    noLlm: true
  };
}

export async function buildPlayerCombatAction({
  toolManager,
  input = {}
} = {}) {
  const listed = await listPlayerCombatActions({ toolManager, input });
  const selectedId = optionalText(input.selectedActionId || input.actionChoiceId || input.choiceId || input.actionId || input.id);
  const selected = selectedId
    ? listed.choices.find((choice) => choice.actionId === selectedId || choice.id === selectedId)
    : listed.choices[0];
  if (!selected) throw validationError(`Player action choice not found: ${selectedId || '(first choice)'}`);
  if (selected.ready === false) throw validationError(`Player action choice is not ready: ${selected.actionId}`);
  const targetId = optionalText(input.targetId || input.targetNpcId || normalizeArray(input.targetIds)[0] || selected.defaultTargetId);
  if (selected.requiresTarget && !targetId) throw validationError(`targetId is required for selected player action: ${selected.actionId}`);
  const resolveActionInput = removeUndefined({
    chatSessionId: input.chatSessionId,
    sceneId: input.sceneId || 'current',
    battleId: input.battleId,
    actionId: input.outputActionId || input.resolveActionId || selected.actionId,
    actorId: input.actorId || input.playerId || input.npcId,
    targetId,
    targetIds: targetId ? undefined : input.targetIds,
    actionKind: selected.actionKind,
    sourceText: input.sourceText || selected.sourceText || `${selected.name}`,
    consumeAction: selected.consumeAction,
    hitResult: input.hitResult,
    attack: selected.attack,
    damage: selected.damage,
    damageRolls: selected.damageRolls,
    healing: selected.healing,
    temporaryHp: selected.temporaryHp,
    statusEffects: selected.statusEffects,
    resourceCosts: selected.resourceCosts,
    ammoCost: selected.ammoCost,
    consumableCost: selected.consumableCost,
    metadata: {
      ...normalizeObject(selected.metadata),
      playerSelectedActionId: selected.actionId,
      playerActionSource: selected.source,
      selectedMechanic: selected.mechanic
    }
  });
  return {
    actor: listed.actor,
    choices: listed.choices,
    selected,
    resolveActionInput,
    noLlm: true
  };
}

export function buildPlayerActionChoices({ actor = {}, mechanics = [], input = {} } = {}) {
  const direct = [
    ...normalizeArray(actor.resources?.combat?.actions),
    ...normalizeArray(actor.resources?.combat?.actionOptions),
    ...normalizeArray(actor.skillBar?.actions),
    ...normalizeArray(actor.skillBar?.spells),
    ...normalizeArray(actor.statusBar?.specialSkills)
  ];
  const choices = direct
    .map((action) => actionToChoice(action, {
      actor,
      mechanic: findMechanicForAction(action, mechanics),
      input,
      source: 'actor_state'
    }))
    .filter(Boolean);

  for (const mechanic of mechanics) {
    const choice = mechanicToChoice(mechanic, { actor, input });
    if (choice) choices.push(choice);
  }

  if (input.includeBasicAttack !== false && !choices.some((choice) => choice.actionId === 'basic_attack')) {
    choices.push(basicAttackChoice(actor, input));
  }
  return dedupeChoices(choices).map((choice) => ({
    ...choice,
    ready: choice.ready !== false,
    reasonUnavailable: choice.ready === false ? (choice.reasonUnavailable || 'not_ready') : undefined
  }));
}

async function collectPlayerMechanics({ toolManager, actor = {}, input = {} } = {}) {
  if (!toolManager?.executeTool) return [];
  const refs = collectMechanicRefs(actor, input);
  const records = [];
  for (const ref of refs) {
    const toolId = mechanicGetTool(ref.kind);
    if (!toolId) continue;
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

function actionToChoice(actionInput, { actor = {}, mechanic, input = {}, source = 'actor_state' } = {}) {
  const action = normalizeObject(actionInput);
  const mechanicAction = normalizeObject(mechanic?.data?.metadata?.combatAction || mechanic?.data?.metadata?.action);
  const numeric = normalizeObject(mechanic?.data?.numericValues || mechanic?.data?.values || mechanic?.data?.numericSettings);
  const merged = deepMerge(mechanicAction, action);
  const id = safeSegment(merged.id || merged.actionId || mechanic?.id || mechanic?.record?.id || createId('playeraction'));
  const mode = normalizeMode(merged.mode || merged.actionMode || merged.actionKind || merged.kind || merged.type || mechanicAction.actionKind || 'attack');
  const actionKind = normalizeActionKind(merged.actionKind || merged.kind || merged.type || mechanicAction.actionKind || mode || 'attack');
  const targetPolicy = optionalText(merged.targetPolicy || merged.targetMode || merged.target || (['defense', 'dodge', 'status', 'healing', 'effect'].includes(actionKind) ? 'self' : ''));
  const selfTarget = isSelfTarget(targetPolicy);
  const statusEffects = [
    ...normalizeArray(merged.statusEffects || merged.statuses || merged.conditions),
    ...defensiveStatusEffects(merged, {
      id,
      actionKind,
      mode,
      actor,
      targetPolicy
    })
  ];
  const choice = {
    id,
    actionId: id,
    name: optionalText(merged.name || merged.label || mechanic?.data?.name || id),
    description: optionalText(merged.description || mechanic?.data?.description || mechanic?.data?.mechanicalEffect),
    source,
    mechanic: mechanic ? { kind: mechanic.kind, id: mechanic.id, name: mechanic.data?.name, source: mechanic.source } : undefined,
    actionKind,
    mode,
    ready: merged.ready !== false && merged.prepared !== false,
    consumeAction: merged.consumeAction !== false,
    targetPolicy,
    requiresTarget: merged.requiresTarget ?? (!selfTarget && !['healing', 'status', 'effect', 'defense', 'dodge'].includes(actionKind)),
    defaultTargetId: optionalText(merged.targetId || input.targetId || (selfTarget ? actor.npcId || actor.actorId || input.actorId : '')),
    sourceText: optionalText(merged.sourceText || merged.text),
    attack: attackPayload(merged, numeric, actor),
    damage: normalizeDamage(merged.damage, numeric),
    damageRolls: normalizeArray(merged.damageRolls || merged.damageDice),
    healing: merged.healing || merged.heals,
    temporaryHp: merged.temporaryHp || merged.tempHp,
    statusEffects,
    resourceCosts: normalizeArray(merged.resourceCosts || merged.costs),
    ammoCost: merged.ammoCost,
    consumableCost: merged.consumableCost,
    metadata: normalizeObject(merged.metadata)
  };
  return choice;
}

function mechanicToChoice(mechanic, { actor = {}, input = {} } = {}) {
  const action = nonEmptyObject(mechanic?.data?.metadata?.combatAction || mechanic?.data?.metadata?.action);
  const numeric = normalizeObject(mechanic?.data?.numericValues || mechanic?.data?.values || mechanic?.data?.numericSettings);
  if (!action && !numeric.damageAmount && !numeric.attackModifier && !numeric.healingAmount && !numeric.acBonus) return undefined;
  return actionToChoice({
    id: mechanic.id,
    name: mechanic.data?.name,
    ...(action || {})
  }, { actor, mechanic, input, source: 'mechanics_registry' });
}

function basicAttackChoice(actor = {}, input = {}) {
  const values = normalizeObject(actor.values);
  return {
    id: 'basic_attack',
    actionId: 'basic_attack',
    name: 'Basic Attack',
    description: 'Default numeric attack when no explicit player action is selected.',
    source: 'default_basic_attack',
    actionKind: 'attack',
    mode: 'attack',
    ready: true,
    consumeAction: true,
    requiresTarget: true,
    defaultTargetId: optionalText(input.targetId),
    attack: {
      successThreshold: input.targetAc,
      diceCount: 1,
      diceSides: 20,
      modifier: numberOr(values.attackModifier, 0),
      criticalMode: 'd20'
    },
    damage: [{ type: 'damage', amount: numberOr(values.damageAmount, 1) }],
    damageRolls: [],
    resourceCosts: [],
    metadata: {}
  };
}

function attackPayload(action = {}, numeric = {}, actor = {}) {
  const values = normalizeObject(actor.values);
  return removeUndefined({
    successThreshold: action.successThreshold ?? action.dc ?? action.targetAc,
    diceCount: numberOr(action.diceCount, action.rollCount, numeric.diceCount, 1),
    diceSides: numberOr(action.diceSides, action.sides, numeric.diceSides, 20),
    modifier: numberOr(action.modifier, action.attackModifier, numeric.attackModifier, values.attackModifier, 0),
    forceMode: optionalText(action.forceMode),
    rollMode: optionalText(action.rollMode),
    inspirationPoints: action.inspirationPoints,
    criticalMode: optionalText(action.criticalMode || 'd20')
  });
}

async function getActorState({ toolManager, chatSessionId, sceneId, actorId }) {
  const result = await safeExecute(toolManager, 'system.npc_state.get_state', {
    chatSessionId,
    sceneId,
    npcId: actorId
  });
  if (!result.ok) throw validationError(`Player actor state not found: ${actorId}`);
  return result.output;
}

async function safeExecute(toolManager, toolId, input) {
  try {
    const result = await toolManager.executeTool(toolId, input);
    return { ok: true, output: result.output, result };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
}

function findMechanicForAction(action = {}, mechanics = []) {
  const kind = action.mechanicKind || (action.featId ? 'feat' : action.statusId ? 'status' : action.skillId ? 'skill' : undefined);
  const id = action.mechanicId || action.skillId || action.featId || action.statusId;
  return kind && id ? mechanics.find((item) => item.kind === kind && item.id === id) : undefined;
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
  const amount = numberOr(numeric.damageAmount, numeric.damage, undefined);
  if (amount !== undefined) return [{ type: optionalText(numeric.damageType) || 'damage', amount }];
  return [];
}

function dedupeChoices(choices = []) {
  const seen = new Set();
  return choices.filter((choice) => {
    if (seen.has(choice.actionId)) return false;
    seen.add(choice.actionId);
    return true;
  });
}

function compactActor(record) {
  const data = record?.data || record || {};
  return {
    actorId: data.npcId,
    name: data.name,
    isPlayer: data.isPlayer,
    values: data.values,
    actionEconomy: data.resources?.actionEconomy,
    skillBar: data.skillBar,
    specialStatuses: data.specialStatuses
  };
}

function normalizeActionKind(value) {
  const normalized = optionalText(value).toLowerCase();
  if (['defend', 'guard', 'block', 'defense'].includes(normalized)) return 'defense';
  if (['evade', 'avoid', 'dodge'].includes(normalized)) return 'dodge';
  if (['heal', 'healing'].includes(normalized)) return 'healing';
  if (['status', 'condition'].includes(normalized)) return 'status';
  if (['effect', 'utility'].includes(normalized)) return 'effect';
  return 'attack';
}

function normalizeMode(value) {
  const normalized = optionalText(value).toLowerCase();
  if (['defend', 'guard', 'block', 'defense'].includes(normalized)) return 'defense';
  if (['evade', 'avoid', 'dodge'].includes(normalized)) return 'dodge';
  return normalizeActionKind(normalized);
}

function isSelfTarget(value) {
  return ['self', 'actor', 'caster', 'user', 'owner', '自己', '自身'].includes(optionalText(value).toLowerCase());
}

function defensiveStatusEffects(merged = {}, { id, actionKind, mode, actor, targetPolicy } = {}) {
  if (!['defense', 'dodge', 'status', 'effect'].includes(actionKind) && !['defense', 'dodge'].includes(mode)) return [];
  const acBonus = numberOr(merged.acBonus, merged.defenseBonus, merged.dodgeBonus, undefined);
  const damageReduction = numberOr(merged.damageReduction, merged.reduction, undefined);
  const duration = numberOr(merged.durationRounds, merged.remainingTurns, merged.rounds, undefined);
  const incomingAttackDisadvantage = merged.incomingAttackDisadvantage === true;
  const dexSaveAdvantage = merged.dexSaveAdvantage === true;
  if (
    acBonus === undefined
    && damageReduction === undefined
    && incomingAttackDisadvantage === false
    && dexSaveAdvantage === false
    && !merged.resistances
    && !merged.immunities
    && !merged.vulnerabilities
  ) {
    return [];
  }
  const statusId = safeSegment(merged.statusId || merged.buffId || `${id}_${mode || actionKind}`);
  const remainingTurns = duration === undefined ? 1 : duration;
  return [{
    id: statusId,
    name: optionalText(merged.statusName || merged.name || statusId),
    active: true,
    remainingTurns,
    source: 'player-combat-action',
    description: optionalText(merged.description || merged.mechanicalEffect),
    metadata: removeUndefined({
      acBonus,
      damageReduction,
      incomingAttackDisadvantage,
      dexSaveAdvantage,
      resistances: merged.resistances,
      vulnerabilities: merged.vulnerabilities,
      immunities: merged.immunities,
      durationTiming: merged.durationTiming || 'endTurn',
      expiresOnActorId: merged.expiresOnActorId || actor.npcId || actor.actorId,
      targetPolicy
    })
  }];
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
  for (const key of ['attack', 'metadata']) {
    if (base?.[key] && override?.[key]) result[key] = { ...normalizeObject(base[key]), ...normalizeObject(override[key]) };
  }
  return result;
}

function numberOr(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function safeSegment(value) {
  return optionalText(value).replace(/[^A-Za-z0-9_.:-]+/g, '_') || createId('playeraction');
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

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ''));
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'PlayerActionSelectionError';
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
