// @ts-nocheck
import { NpcStructuredStateDatabase } from '../npcs/npc-structured-state.js';
import { StructuredInterfaceTraceRecorder } from '../structured/structured-interface.js';
import { createId } from '../utils/id.js';

export const DAMAGE_SETTLEMENT_TRACE_DIR = 'data/effect-settlement-traces';

export const DEFAULT_SETTLEMENT_RULES = {
  resistanceRounding: 'floor',
  vulnerabilityMultiplier: 2,
  resistanceMultiplier: 0.5,
  instantDeath: true,
  deathSaveFailuresFromDamageAtZero: 1,
  criticalDamageAtZeroFailures: 2,
  concentrationBaseDc: 10,
  concentrationDamageDivisor: 2,
  tempHpMode: 'max'
};

export const DAMAGE_SETTLEMENT_TEMPLATES = {
  damage: {
    id: 'damage_settlement',
    description: 'Apply already-rolled damage after hit/save resolution.',
    input: {
      chatSessionId: 'chat id',
      sceneId: 'current',
      targets: [{
        npcId: 'npc_or_pc_id',
        hit: { outcome: 'hit', critical: false },
        damage: [{ type: 'fire', amount: 12, roll: { expression: '2d6+5', total: 12 } }],
        defenses: { resistances: ['fire'], vulnerabilities: [], immunities: [] }
      }]
    }
  },
  healing: {
    id: 'healing_settlement',
    description: 'Apply deterministic healing and reset death saves when HP rises above zero.',
    input: {
      chatSessionId: 'chat id',
      targets: [{ npcId: 'pc_arin', healing: [{ amount: 8, type: 'spell' }] }]
    }
  },
  status: {
    id: 'status_settlement',
    description: 'Apply or remove status effects, durations, periodic effects, and concentration-linked spell states in the same Actor state database.',
    input: {
      chatSessionId: 'chat id',
      targets: [{
        npcId: 'npc_guard',
        statusEffects: [
          { id: 'poisoned', name: 'Poisoned', tickTiming: 'endTurn', damage: [{ type: 'poison', amount: 3 }] },
          { id: 'burning', name: 'Burning', remainingTurns: 3, tickTiming: 'endTurn', damage: [{ type: 'fire', amount: 2 }] },
          { id: 'shield', name: 'Shield', remainingTurns: 1, durationTiming: 'endTurn' }
        ]
      }]
    }
  }
};

export class EffectSettlementResolver {
  constructor({
    appDatabase,
    npcState,
    stateDatabase,
    trace,
    traceRecorder,
    cwd = process.cwd(),
    now
  } = {}) {
    if (!appDatabase && !npcState && !stateDatabase) throw validationError('EffectSettlementResolver requires appDatabase or npcState database');
    this.npcState = npcState || stateDatabase || new NpcStructuredStateDatabase({
      appDatabase,
      trace: trace === false ? false : trace?.npcState
    });
    this.now = now || (() => new Date().toISOString());
    this.traceRecorder = traceRecorder || new StructuredInterfaceTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      directory: trace?.directory || DAMAGE_SETTLEMENT_TRACE_DIR,
      cwd,
      now: this.now
    });
  }

  describe() {
    return {
      name: 'EffectSettlementResolver',
      diceIndependent: true,
      rules: DEFAULT_SETTLEMENT_RULES,
      templates: DAMAGE_SETTLEMENT_TEMPLATES,
      stateTarget: 'npc_structured_states',
      flow: [
        'hit/save result is supplied by caller',
        'damage/healing/status amounts are supplied by caller',
        'apply immunity/resistance/vulnerability',
        'absorb with temporary HP',
        'update HP and death save state',
        'create or resolve concentration check requirement',
        'normalize status duration and periodic effect metadata',
        'remove concentration-linked spell statuses when concentration breaks',
        'write NPC/PC Actor state when applySettlement is used'
      ]
    };
  }

  previewSettlement(input = {}) {
    return this.withTrace('effect-settlement-preview', input.chatSessionId, input, () => this.resolveSettlement(input, {
      dryRun: true
    }));
  }

  applySettlement(input = {}) {
    return this.withTrace('effect-settlement-apply', input.chatSessionId, input, () => {
      const settlement = this.resolveSettlement(input, { dryRun: false });
      const records = [];
      for (const target of settlement.targets) {
        records.push(this.npcState.patchNpcState(target.patch, { source: input.source || 'effect-settlement' }).record);
      }
      return {
        ...settlement,
        records,
        dryRun: false
      };
    });
  }

  resolveSettlement(input = {}, { dryRun = true } = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const sceneId = normalizeSceneId(input.sceneId);
    const rules = normalizeSettlementRules(input.rules);
    const targetInputs = normalizeTargetInputs(input);
    const targets = targetInputs.map((targetInput) => this.resolveTargetSettlement({
      chatSessionId,
      sceneId: normalizeSceneId(targetInput.sceneId || sceneId),
      targetInput,
      rules
    }));
    return {
      settlementId: normalizeOptionalText(input.settlementId) || createId('settlement'),
      chatSessionId,
      sceneId,
      sourceActionId: normalizeOptionalText(input.sourceActionId || input.actionId),
      source: normalizeOptionalText(input.source) || 'effect-settlement',
      diceIndependent: true,
      rules,
      targets,
      requiredChecks: targets.flatMap((target) => target.requiredChecks),
      totalDamage: targets.reduce((sum, target) => sum + target.totals.damageAfterDefenses, 0),
      totalHealing: targets.reduce((sum, target) => sum + target.totals.healingApplied, 0),
      dryRun
    };
  }

  resolveTargetSettlement({ chatSessionId, sceneId, targetInput, rules }) {
    const identity = normalizeTargetIdentity(targetInput);
    const currentRecord = findActorState(this.npcState, {
      chatSessionId,
      sceneId,
      npcId: identity.npcId
    });
    const current = normalizeActorState(currentRecord?.data, targetInput, { chatSessionId, sceneId, identity });
    const hit = normalizeHit(targetInput.hit ?? targetInput.attack ?? targetInput.outcome);
    const damageItems = normalizeDamageItems(targetInput.damage ?? targetInput.damages ?? targetInput.damageRolls);
    const healingItems = normalizeHealingItems(targetInput.healing ?? targetInput.heals);
    const tempHpRequest = normalizeTemporaryHpRequest(targetInput.temporaryHp ?? targetInput.tempHp);
    const statusEffects = normalizeStatusEffects(targetInput.statusEffects ?? targetInput.statuses ?? targetInput.conditions);
    const defenses = resolveDefenses(current, targetInput);
    const concentrationBefore = resolveConcentration(current, targetInput);
    const deathSavesBefore = resolveDeathSaves(current, targetInput);

    const damageResolution = resolveDamageItems(damageItems, {
      defenses,
      hit,
      rules,
      applyDamageOnMiss: Boolean(targetInput.applyDamageOnMiss)
    });
    const hpBefore = current.hp;
    const maxHp = current.maxHp;
    const tempHpBefore = current.temporaryHp;
    const tempAbsorbed = Math.min(tempHpBefore, damageResolution.total);
    const damageToHp = Math.max(0, damageResolution.total - tempAbsorbed);
    let hpAfterDamage = Math.max(0, hpBefore - damageToHp);
    let tempHpAfter = Math.max(0, tempHpBefore - tempAbsorbed);
    let deathSaves = { ...deathSavesBefore };
    let deathState = resolveDeathState(current, { hpBefore, hpAfterDamage, maxHp, damageToHp, hit, rules, deathSaves });

    const healingResolution = resolveHealingItems(healingItems, {
      hp: hpAfterDamage,
      maxHp,
      dead: deathState.dead,
      allowHealingDead: Boolean(targetInput.allowHealingDead)
    });
    const hpAfterHealing = healingResolution.hpAfter;
    if (hpAfterDamage <= 0 && hpAfterHealing > 0) {
      deathSaves = emptyDeathSaves();
      deathState = {
        dead: false,
        stable: false,
        dying: false,
        unconscious: false,
        reason: 'healed_above_zero'
      };
    }

    if (tempHpRequest) {
      tempHpAfter = applyTemporaryHp(tempHpAfter, tempHpRequest, rules);
    }

    const deathSaveResolution = resolveDeathSaveInput(targetInput.deathSave ?? targetInput.deathSaveResult, {
      hp: hpAfterHealing,
      maxHp,
      deathSaves,
      deathState
    });
    deathSaves = deathSaveResolution.deathSaves;
    deathState = deathSaveResolution.deathState;

    const concentration = resolveConcentrationOutcome({
      concentrationBefore,
      checkInput: targetInput.concentrationCheck ?? targetInput.concentrationSave,
      damageToHp,
      rules,
      target: identity
    });
    const statusResolution = resolveStatusEffects({
      current,
      statusEffects,
      deathState,
      concentration
    });

    const hpFinal = deathState.naturalTwentyRevive ? 1 : hpAfterHealing;
    const patch = buildStatePatch({
      chatSessionId,
      sceneId,
      identity,
      current,
      hp: hpFinal,
      maxHp,
      temporaryHp: tempHpAfter,
      deathSaves,
      deathState,
      concentration,
      statusResolution,
      targetInput
    });

    return {
      targetId: identity.npcId,
      name: identity.name || current.name,
      actorType: identity.actorType || current.actorType,
      isPlayer: identity.isPlayer ?? current.isPlayer,
      currentRecordId: currentRecord?.id,
      hit,
      defenses,
      damage: damageResolution.items,
      healing: healingResolution.items,
      temporaryHp: {
        before: tempHpBefore,
        absorbed: tempAbsorbed,
        after: tempHpAfter,
        request: tempHpRequest
      },
      hp: {
        before: hpBefore,
        afterDamage: hpAfterDamage,
        afterHealing: hpAfterHealing,
        final: hpFinal,
        maxHp
      },
      deathSaves: {
        before: deathSavesBefore,
        after: deathSaves,
        state: deathState,
        input: deathSaveResolution.input
      },
      concentration,
      statuses: statusResolution,
      totals: {
        rawDamage: damageResolution.rawTotal,
        damageAfterDefenses: damageResolution.total,
        tempHpAbsorbed: tempAbsorbed,
        damageToHp,
        healingRequested: healingResolution.requested,
        healingApplied: healingResolution.applied
      },
      requiredChecks: concentration.requiredCheck ? [concentration.requiredCheck] : [],
      patch
    };
  }

  withTrace(operation, chatSessionId, input, fn) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const sceneId = normalizeSceneId(input.sceneId);
    const before = this.npcState.stateSnapshot({ chatSessionId: normalizedChatSessionId, sceneId, includeAllScenes: !input.sceneId });
    const trace = this.traceRecorder.start(operation, {
      sessionId: normalizedChatSessionId,
      input,
      stateBefore: before
    });
    try {
      const output = fn();
      const after = this.npcState.stateSnapshot({ chatSessionId: normalizedChatSessionId, sceneId, includeAllScenes: !input.sceneId });
      return {
        ...output,
        trace: this.traceRecorder.finish(trace, {
          output,
          stateAfter: after
        })
      };
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }
}

function resolveDamageItems(items, { defenses, hit, rules, applyDamageOnMiss }) {
  if (hit.outcome === 'miss' && !applyDamageOnMiss) {
    return {
      rawTotal: 0,
      total: 0,
      items: items.map((item) => ({
        ...item,
        skipped: true,
        skipReason: 'miss'
      }))
    };
  }
  const resolved = items.map((item) => resolveDamageItem(item, { defenses, rules }));
  return {
    rawTotal: resolved.reduce((sum, item) => sum + item.amount, 0),
    total: resolved.reduce((sum, item) => sum + item.finalAmount, 0),
    items: resolved
  };
}

function resolveDamageItem(item, { defenses, rules }) {
  const type = normalizeDamageType(item.type);
  const tags = new Set(normalizeStringArray(item.tags).map(normalizeDamageType));
  const effectiveTypes = new Set([type, ...tags]);
  const amount = normalizeNonNegativeNumber(item.amount ?? item.total ?? item.roll?.total ?? item.rollTotal, 'damage.amount');
  const immune = !item.ignoreImmunity && intersects(effectiveTypes, defenses.immunities);
  const resistant = !immune && !item.ignoreResistance && intersects(effectiveTypes, defenses.resistances);
  const vulnerable = !immune && !item.ignoreVulnerability && intersects(effectiveTypes, defenses.vulnerabilities);
  let finalAmount = amount;
  const modifiers = [];
  if (immune) {
    finalAmount = 0;
    modifiers.push({ type: 'immunity', multiplier: 0 });
  } else {
    if (resistant) {
      finalAmount = applyRounding(finalAmount * rules.resistanceMultiplier, rules.resistanceRounding);
      modifiers.push({ type: 'resistance', multiplier: rules.resistanceMultiplier });
    }
    if (vulnerable) {
      finalAmount *= rules.vulnerabilityMultiplier;
      modifiers.push({ type: 'vulnerability', multiplier: rules.vulnerabilityMultiplier });
    }
  }
  return {
    id: normalizeOptionalText(item.id) || createId('damage'),
    type,
    amount,
    finalAmount,
    roll: normalizeRoll(item.roll ?? item),
    tags: [...tags],
    magical: Boolean(item.magical),
    modifiers,
    note: normalizeOptionalText(item.note || item.description)
  };
}

function resolveHealingItems(items, { hp, maxHp, dead, allowHealingDead }) {
  const normalizedItems = items.map((item) => ({
    id: normalizeOptionalText(item.id) || createId('healing'),
    type: normalizeOptionalText(item.type) || 'healing',
    amount: normalizeNonNegativeNumber(item.amount ?? item.total ?? item.roll?.total ?? item.rollTotal, 'healing.amount'),
    roll: normalizeRoll(item.roll ?? item),
    note: normalizeOptionalText(item.note || item.description)
  }));
  const requested = normalizedItems.reduce((sum, item) => sum + item.amount, 0);
  if (dead && !allowHealingDead) {
    return {
      requested,
      applied: 0,
      hpAfter: hp,
      items: normalizedItems.map((item) => ({ ...item, applied: 0, skipped: true, skipReason: 'target_dead' }))
    };
  }
  const hpAfter = maxHp > 0 ? Math.min(maxHp, hp + requested) : hp + requested;
  const applied = Math.max(0, hpAfter - hp);
  let remaining = applied;
  const resolved = normalizedItems.map((item) => {
    const itemApplied = Math.min(item.amount, remaining);
    remaining -= itemApplied;
    return {
      ...item,
      applied: itemApplied
    };
  });
  return {
    requested,
    applied,
    hpAfter,
    items: resolved
  };
}

function resolveDeathState(current, { hpBefore, hpAfterDamage, maxHp, damageToHp, hit, rules, deathSaves }) {
  if (isDead(current)) {
    return { dead: true, stable: false, dying: false, unconscious: false, reason: 'already_dead' };
  }
  if (hpBefore > 0 && hpAfterDamage <= 0 && rules.instantDeath && damageToHp - hpBefore >= maxHp && maxHp > 0) {
    return { dead: true, stable: false, dying: false, unconscious: false, reason: 'massive_damage' };
  }
  if (hpBefore <= 0 && damageToHp > 0) {
    const failures = hit.critical
      ? rules.criticalDamageAtZeroFailures
      : rules.deathSaveFailuresFromDamageAtZero;
    deathSaves.failures = Math.min(3, deathSaves.failures + failures);
    if (deathSaves.failures >= 3) {
      return { dead: true, stable: false, dying: false, unconscious: false, reason: 'death_save_failures_from_damage' };
    }
  }
  if (hpAfterDamage <= 0) {
    return {
      dead: false,
      stable: false,
      dying: true,
      unconscious: true,
      reason: hpBefore > 0 ? 'reduced_to_zero' : 'still_at_zero'
    };
  }
  return { dead: false, stable: false, dying: false, unconscious: false, reason: 'above_zero' };
}

function resolveDeathSaveInput(input, { hp, deathSaves, deathState }) {
  if (!input) {
    if (deathState.dead) return { input: undefined, deathSaves: { successes: deathSaves.successes, failures: 3 }, deathState };
    return { input: undefined, deathSaves, deathState };
  }
  const outcome = normalizeDeathSaveOutcome(input.outcome || input.result || input);
  const next = { ...deathSaves };
  const state = { ...deathState };
  if (hp > 0 && !input.force) {
    return {
      input: { outcome, ignored: true, reason: 'hp_above_zero' },
      deathSaves: emptyDeathSaves(),
      deathState: { dead: false, stable: false, dying: false, unconscious: false, reason: 'hp_above_zero' }
    };
  }
  if (outcome === 'criticalSuccess') {
    return {
      input: { outcome },
      deathSaves: emptyDeathSaves(),
      deathState: {
        dead: false,
        stable: false,
        dying: false,
        unconscious: false,
        naturalTwentyRevive: true,
        reason: 'death_save_natural_20'
      }
    };
  }
  if (outcome === 'criticalFailure') next.failures += 2;
  if (outcome === 'failure') next.failures += 1;
  if (outcome === 'success') next.successes += 1;
  next.successes = Math.max(0, Math.min(3, next.successes));
  next.failures = Math.max(0, Math.min(3, next.failures));
  if (next.failures >= 3) {
    return {
      input: { outcome },
      deathSaves: { successes: next.successes, failures: 3 },
      deathState: { dead: true, stable: false, dying: false, unconscious: false, reason: 'death_save_failures' }
    };
  }
  if (next.successes >= 3) {
    return {
      input: { outcome },
      deathSaves: { successes: 3, failures: 0 },
      deathState: { dead: false, stable: true, dying: false, unconscious: true, reason: 'death_save_stabilized' }
    };
  }
  state.dying = true;
  state.unconscious = true;
  return {
    input: { outcome },
    deathSaves: next,
    deathState: state
  };
}

function resolveConcentrationOutcome({ concentrationBefore, checkInput, damageToHp, rules, target }) {
  const needed = concentrationBefore.active && damageToHp > 0;
  const dc = needed ? Math.max(rules.concentrationBaseDc, Math.floor(damageToHp / rules.concentrationDamageDivisor)) : 0;
  const result = {
    before: concentrationBefore,
    needed,
    dc,
    active: concentrationBefore.active,
    broken: false,
    requiredCheck: undefined,
    check: undefined
  };
  if (!needed) return result;
  if (!checkInput) {
    result.requiredCheck = {
      checkType: 'concentration',
      targetNpcId: target.npcId,
      successThreshold: dc,
      ability: 'constitution',
      reason: 'damage_taken_while_concentrating'
    };
    return result;
  }
  const success = Boolean(checkInput.success ?? ['success', 'criticalSuccess'].includes(String(checkInput.outcome || checkInput.result)));
  result.check = {
    outcome: normalizeOptionalText(checkInput.outcome || checkInput.result) || (success ? 'success' : 'failure'),
    success,
    total: normalizeOptionalNumber(checkInput.total),
    dc
  };
  result.active = success;
  result.broken = !success;
  return result;
}

function resolveStatusEffects({ current, statusEffects, deathState, concentration }) {
  const conditions = new Set(normalizeStringArray(current.conditions));
  const specialStatuses = [];
  const addStatus = (status) => {
    if (status.conditionName) conditions.add(status.conditionName);
    specialStatuses.push(status);
  };
  const removeStatus = (id, conditionName = id) => {
    if (conditionName) conditions.delete(conditionName);
    specialStatuses.push({ id, name: conditionName || id, _delete: true });
  };

  for (const effect of statusEffects) {
    if (['remove', 'delete', 'end'].includes(effect.operation)) {
      removeStatus(effect.id, effect.conditionName || effect.name);
    } else {
      addStatus(effect);
    }
  }
  if (deathState.dead) {
    conditions.delete('dying');
    conditions.delete('unconscious');
    conditions.delete('stable');
    conditions.add('dead');
    addStatus({ id: 'dead', name: 'dead', active: true, conditionName: 'dead', description: 'Dead.' });
    removeStatus('dying', 'dying');
    removeStatus('unconscious', 'unconscious');
    removeStatus('stable', 'stable');
  } else if (deathState.dying) {
    conditions.add('unconscious');
    conditions.add('dying');
    conditions.delete('stable');
    addStatus({ id: 'unconscious', name: 'unconscious', active: true, conditionName: 'unconscious' });
    addStatus({ id: 'dying', name: 'dying', active: true, conditionName: 'dying' });
    removeStatus('stable', 'stable');
  } else if (deathState.stable) {
    conditions.add('unconscious');
    conditions.add('stable');
    conditions.delete('dying');
    addStatus({ id: 'unconscious', name: 'unconscious', active: true, conditionName: 'unconscious' });
    addStatus({ id: 'stable', name: 'stable', active: true, conditionName: 'stable' });
    removeStatus('dying', 'dying');
  } else {
    conditions.delete('dead');
    conditions.delete('dying');
    conditions.delete('unconscious');
    conditions.delete('stable');
    removeStatus('dead', 'dead');
    removeStatus('dying', 'dying');
    removeStatus('unconscious', 'unconscious');
    removeStatus('stable', 'stable');
  }
  if (concentration.broken) {
    conditions.delete('concentrating');
    removeStatus('concentration', 'concentrating');
    for (const status of current.specialStatuses.filter((item) => isConcentrationLinkedStatus(item, concentration))) {
      conditions.delete(String(status.id || '').trim());
      conditions.delete(String(status.name || '').trim());
      const metadata = normalizeObject(status.metadata);
      conditions.delete(normalizeOptionalText(metadata.conditionName || metadata.condition));
      removeStatus(status.id || status.name, metadata.conditionName || metadata.condition || status.name || status.id);
    }
  } else if (concentration.active) {
    conditions.add('concentrating');
    addStatus({
      id: 'concentration',
      name: 'concentrating',
      active: true,
      conditionName: 'concentrating',
      metadata: {
        spellId: concentration.before?.spellId || concentration.spellId,
        linkedStatusIds: concentration.before?.linkedStatusIds || []
      }
    });
  }
  return {
    conditions: [...conditions].filter(Boolean).sort(),
    specialStatusUpdates: dedupeStatusUpdates(specialStatuses)
  };
}

function buildStatePatch({
  chatSessionId,
  sceneId,
  identity,
  current,
  hp,
  maxHp,
  temporaryHp,
  deathSaves,
  deathState,
  concentration,
  statusResolution,
  targetInput
}) {
  const statusBar = {
    ...current.statusBar,
    hp,
    maxHp,
    temporaryHp,
    deathSaves: {
      successes: deathSaves.successes,
      failures: deathSaves.failures,
      stable: deathState.stable,
      dying: deathState.dying,
      dead: deathState.dead
    },
    concentration: {
      ...(current.statusBar.concentration || {}),
      active: concentration.active,
      broken: concentration.broken,
      pendingCheck: concentration.requiredCheck || undefined,
      lastCheck: concentration.check || undefined,
      dc: concentration.dc || undefined
    },
    conditions: statusResolution.conditions
  };
  return {
    chatSessionId,
    sceneId,
    npcId: identity.npcId,
    actorType: identity.actorType || current.actorType,
    isPlayer: identity.isPlayer ?? current.isPlayer,
    playerId: identity.playerId || current.playerId,
    name: identity.name || current.name || identity.npcId,
    values: {
      hp,
      maxHp,
      temporaryHp,
      deathSaveSuccesses: deathSaves.successes,
      deathSaveFailures: deathSaves.failures
    },
    statusBar,
    specialStatuses: statusResolution.specialStatusUpdates,
    source: normalizeOptionalText(targetInput.source) || 'effect-settlement'
  };
}

function normalizeTargetInputs(input = {}) {
  const targets = input.targets ?? input.target ?? input.actors ?? input.actor;
  if (targets !== undefined && targets !== null) {
    const array = Array.isArray(targets) ? targets : [targets];
    if (array.length === 0) throw validationError('targets must not be empty');
    return array.map((target) => {
      if (!target || typeof target !== 'object' || Array.isArray(target)) throw validationError('target must be a plain object');
      return target;
    });
  }
  if (input.npcId || input.playerId || input.id) return [input];
  throw validationError('targets or npcId is required');
}

function normalizeTargetIdentity(input = {}) {
  const npcId = safeSegment(normalizeRequiredText(input.npcId || input.playerId || input.actorId || input.id, 'npcId'));
  const actorType = normalizeOptionalText(input.actorType || input.type || (input.isPlayer || input.playerId ? 'player' : 'npc'));
  const isPlayer = input.isPlayer !== undefined || input.player !== undefined || input.playerId
    ? normalizeBoolean(input.isPlayer ?? input.player ?? Boolean(input.playerId))
    : undefined;
  return {
    npcId,
    actorType: isPlayer ? 'player' : actorType || 'npc',
    isPlayer,
    playerId: normalizeOptionalText(input.playerId || input.protagonistId),
    name: normalizeOptionalText(input.name)
  };
}

function normalizeActorState(record, targetInput, { chatSessionId, sceneId, identity }) {
  const data = record && typeof record === 'object' && !Array.isArray(record) ? record : {};
  const statusBar = normalizeObject(data.statusBar);
  const values = normalizeObject(data.values);
  const hp = firstFiniteNumber(targetInput.currentHp, targetInput.hp, values.hp, statusBar.hp, targetInput.maxHp, values.maxHp, statusBar.maxHp, 0);
  const maxHp = firstFiniteNumber(targetInput.maxHp, values.maxHp, statusBar.maxHp, hp);
  const temporaryHp = firstFiniteNumber(targetInput.currentTemporaryHp, targetInput.temporaryHpBefore, targetInput.tempHpBefore, values.temporaryHp, values.tempHp, statusBar.temporaryHp, statusBar.tempHp, 0);
  return {
    chatSessionId,
    sceneId,
    npcId: identity.npcId,
    name: identity.name || data.name || identity.npcId,
    actorType: identity.actorType || data.actorType || 'npc',
    isPlayer: identity.isPlayer ?? data.isPlayer ?? false,
    playerId: identity.playerId || data.playerId || '',
    values,
    statusBar,
    specialStatuses: normalizeArray(data.specialStatuses),
    hp,
    maxHp,
    temporaryHp,
    conditions: normalizeStringArray(statusBar.conditions)
  };
}

function findActorState(npcState, { chatSessionId, sceneId, npcId }) {
  const listed = npcState.listNpcStates({
    chatSessionId,
    sceneId,
    npcId,
    limit: 2
  });
  return listed.records[0];
}

function resolveDefenses(current, input) {
  const source = {
    ...(current.statusBar.defenses || {}),
    ...(current.statusBar.damageDefenses || {}),
    ...normalizeObject(input.defenses)
  };
  return {
    resistances: normalizeDamageTypeSet(input.resistances ?? source.resistances ?? source.resistance),
    vulnerabilities: normalizeDamageTypeSet(input.vulnerabilities ?? source.vulnerabilities ?? source.vulnerability),
    immunities: normalizeDamageTypeSet(input.immunities ?? source.immunities ?? source.immunity)
  };
}

function resolveConcentration(current, input) {
  const status = current.specialStatuses.find((item) => ['concentration', 'concentrating'].includes(String(item.id || item.name).toLowerCase()));
  const bar = normalizeObject(current.statusBar.concentration);
  const supplied = normalizeObject(input.concentration);
  const active = supplied.active ?? input.concentrating ?? bar.active ?? status?.active ?? false;
  return {
    active: normalizeBoolean(active),
    spellId: normalizeOptionalText(supplied.spellId || bar.spellId || status?.metadata?.spellId),
    source: normalizeOptionalText(supplied.source || bar.source || status?.source),
    linkedStatusIds: normalizeStringArray(
      supplied.linkedStatusIds
      || supplied.linkedStatuses
      || bar.linkedStatusIds
      || bar.linkedStatuses
      || status?.metadata?.linkedStatusIds
      || status?.metadata?.linkedStatuses
    )
  };
}

function resolveDeathSaves(current, input) {
  const bar = normalizeObject(current.statusBar.deathSaves);
  return {
    successes: normalizeInteger(input.deathSaveSuccesses ?? input.deathSaves?.successes ?? bar.successes ?? current.values.deathSaveSuccesses ?? 0, 'deathSaveSuccesses', 0, 3),
    failures: normalizeInteger(input.deathSaveFailures ?? input.deathSaves?.failures ?? bar.failures ?? current.values.deathSaveFailures ?? 0, 'deathSaveFailures', 0, 3)
  };
}

function normalizeHit(value) {
  if (typeof value === 'string') {
    return { outcome: normalizeHitOutcome(value), critical: value === 'critical' || value === 'criticalHit' };
  }
  if (typeof value === 'boolean') {
    return { outcome: value ? 'hit' : 'miss', critical: false };
  }
  const input = normalizeObject(value);
  const outcome = normalizeHitOutcome(input.outcome || input.result || input.status || (input.hit === false || input.miss ? 'miss' : 'hit'));
  return {
    outcome,
    critical: Boolean(input.critical || outcome === 'criticalHit'),
    source: normalizeOptionalText(input.source),
    margin: normalizeOptionalNumber(input.margin)
  };
}

function normalizeHitOutcome(value) {
  const normalized = String(value || 'hit').trim();
  if (['hit', 'success', 'criticalSuccess'].includes(normalized)) return 'hit';
  if (['critical', 'criticalHit'].includes(normalized)) return 'criticalHit';
  if (['miss', 'failure', 'criticalFailure'].includes(normalized)) return 'miss';
  if (['saveSuccess', 'saveFailure', 'partial'].includes(normalized)) return normalized;
  return normalized;
}

function normalizeDamageItems(value) {
  return normalizeArray(value).map((item) => {
    if (typeof item === 'number') return { amount: item, type: 'untyped' };
    if (typeof item === 'string') return { amount: Number(item), type: 'untyped' };
    const object = normalizeObject(item);
    return object;
  }).filter((item) => item.amount !== undefined || item.total !== undefined || item.roll?.total !== undefined || item.rollTotal !== undefined);
}

function normalizeHealingItems(value) {
  return normalizeArray(value).map((item) => {
    if (typeof item === 'number') return { amount: item, type: 'healing' };
    if (typeof item === 'string') return { amount: Number(item), type: 'healing' };
    return normalizeObject(item);
  }).filter((item) => item.amount !== undefined || item.total !== undefined || item.roll?.total !== undefined || item.rollTotal !== undefined);
}

function normalizeTemporaryHpRequest(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') return { amount: value, mode: 'max' };
  const object = normalizeObject(value);
  return {
    amount: normalizeNonNegativeNumber(object.amount ?? object.value ?? object.total ?? 0, 'temporaryHp.amount'),
    mode: normalizeOptionalText(object.mode || object.operation) || 'max'
  };
}

function normalizeStatusEffects(value) {
  return normalizeArray(value).map((item) => {
    if (typeof item === 'string') return { id: safeSegment(item), name: item, operation: 'add', active: true, conditionName: item };
    const object = normalizeObject(item);
    const id = safeSegment(normalizeOptionalText(object.id || object.name || object.status));
    const metadata = normalizeStatusMetadata(object);
    return {
      id,
      name: normalizeOptionalText(object.name || object.status || object.id) || id,
      operation: normalizeOptionalText(object.operation || object.mode || (object._delete ? 'remove' : 'add')),
      active: object.active !== false,
      stacks: normalizeOptionalNumber(object.stacks),
      intensity: normalizeOptionalNumber(object.intensity ?? object.value),
      remainingTurns: normalizeOptionalNumber(resolveRemainingTurns(object)),
      source: normalizeOptionalText(object.source),
      description: normalizeOptionalText(object.description || object.text),
      metadata,
      conditionName: normalizeOptionalText(object.conditionName || object.condition || object.name || object.id),
      _delete: object._delete === true || ['remove', 'delete', 'end'].includes(normalizeOptionalText(object.operation || object.mode))
    };
  }).filter((item) => item.id);
}

function normalizeStatusMetadata(object) {
  const metadata = normalizeObject(object.metadata);
  const duration = normalizeObject(object.duration);
  const periodic = {
    ...normalizeObject(metadata.periodic),
    ...normalizeObject(object.periodic)
  };
  const tickTiming = normalizeOptionalText(
    object.tickTiming
    || object.timing
    || object.triggerTiming
    || metadata.tickTiming
    || metadata.timing
    || periodic.tickTiming
  );
  if (tickTiming) {
    metadata.tickTiming = tickTiming;
    periodic.tickTiming = tickTiming;
  }
  const durationTiming = normalizeOptionalText(
    object.durationTiming
    || object.expiresAtTiming
    || object.expireTiming
    || duration.timing
    || duration.tickTiming
    || metadata.durationTiming
    || metadata.expiresAtTiming
    || metadata.expireTiming
  );
  if (durationTiming) metadata.durationTiming = durationTiming;
  const durationType = normalizeOptionalText(object.durationType || duration.type || metadata.durationType);
  if (durationType) metadata.durationType = durationType;
  const remainingTurns = normalizeOptionalNumber(resolveRemainingTurns(object));
  if (remainingTurns !== undefined) metadata.remainingTurns = remainingTurns;
  const expiresOnActorId = normalizeOptionalText(
    object.expiresOnActorId
    || object.durationActorId
    || object.turnActorId
    || duration.expiresOnActorId
    || duration.actorId
    || metadata.expiresOnActorId
    || metadata.durationActorId
    || metadata.turnActorId
  );
  if (expiresOnActorId) metadata.expiresOnActorId = expiresOnActorId;

  const damage = normalizeEffectAmountList(
    object.periodicDamage
    ?? object.damagePerTurn
    ?? object.damagePerRound
    ?? object.damage
    ?? periodic.damage
    ?? metadata.damage
    ?? metadata.damagePerTurn
    ?? metadata.damagePerRound,
    'damage'
  );
  const healing = normalizeEffectAmountList(
    object.periodicHealing
    ?? object.healingPerTurn
    ?? object.healingPerRound
    ?? object.healing
    ?? periodic.healing
    ?? metadata.healing
    ?? metadata.healingPerTurn
    ?? metadata.healingPerRound,
    'healing'
  );
  if (damage.length) {
    metadata.damage = damage;
    periodic.damage = damage;
  }
  if (healing.length) {
    metadata.healing = healing;
    periodic.healing = healing;
  }
  if (Object.keys(periodic).length) metadata.periodic = periodic;

  const spellId = normalizeOptionalText(object.spellId || object.concentrationSpellId || metadata.spellId);
  if (spellId) metadata.spellId = spellId;
  const requiresConcentration = object.requiresConcentration ?? object.concentrationRequired ?? object.concentration ?? metadata.requiresConcentration;
  if (requiresConcentration !== undefined) metadata.requiresConcentration = normalizeBoolean(requiresConcentration);
  const removeOnBreak = object.removeOnConcentrationBreak ?? object.removeWhenConcentrationBreaks ?? metadata.removeOnConcentrationBreak;
  if (removeOnBreak !== undefined) metadata.removeOnConcentrationBreak = normalizeBoolean(removeOnBreak);
  const linkedStatusIds = normalizeStringArray(object.linkedStatusIds || object.linkedStatuses || metadata.linkedStatusIds || metadata.linkedStatuses);
  if (linkedStatusIds.length) metadata.linkedStatusIds = linkedStatusIds;
  if (object.conditionName || object.condition) metadata.conditionName = normalizeOptionalText(object.conditionName || object.condition);
  return metadata;
}

function resolveRemainingTurns(object) {
  const duration = normalizeObject(object.duration);
  return object.remainingTurns
    ?? object.turns
    ?? object.durationTurns
    ?? object.durationRounds
    ?? object.remainingRounds
    ?? duration.remainingTurns
    ?? duration.turns
    ?? duration.rounds
    ?? (typeof object.duration === 'number' ? object.duration : undefined);
}

function normalizeEffectAmountList(value, defaultType) {
  if (value === undefined || value === null || value === '') return [];
  return normalizeArray(value).map((item) => {
    if (typeof item === 'number' || typeof item === 'string') {
      return {
        type: defaultType === 'damage' ? 'untyped' : 'healing',
        amount: Number(item)
      };
    }
    const object = normalizeObject(item);
    return {
      type: normalizeOptionalText(object.type || object.damageType) || (defaultType === 'damage' ? 'untyped' : 'healing'),
      amount: Number(object.amount ?? object.total ?? object.value ?? object.roll?.total ?? object.rollTotal ?? 0),
      note: normalizeOptionalText(object.note || object.description)
    };
  }).filter((item) => Number.isFinite(item.amount) && item.amount > 0);
}

function isConcentrationLinkedStatus(status, concentration) {
  if (!status || status.active === false) return false;
  const id = normalizeOptionalText(status.id || status.name);
  if (['concentration', 'concentrating'].includes(id.toLowerCase())) return false;
  const metadata = normalizeObject(status.metadata);
  const linkedIds = new Set(normalizeStringArray(concentration.before?.linkedStatusIds || concentration.linkedStatusIds));
  if (linkedIds.has(id)) return true;
  const spellId = normalizeOptionalText(concentration.before?.spellId || concentration.spellId);
  if (spellId && normalizeOptionalText(metadata.spellId) === spellId) return true;
  if (normalizeBoolean(metadata.removeOnConcentrationBreak)) return true;
  if (normalizeBoolean(metadata.requiresConcentration || metadata.concentrationRequired || metadata.concentration)) return true;
  return false;
}

function normalizeSettlementRules(input) {
  const object = normalizeObject(input);
  return {
    ...DEFAULT_SETTLEMENT_RULES,
    ...object,
    resistanceMultiplier: normalizePositiveNumber(object.resistanceMultiplier ?? DEFAULT_SETTLEMENT_RULES.resistanceMultiplier, 'rules.resistanceMultiplier'),
    vulnerabilityMultiplier: normalizePositiveNumber(object.vulnerabilityMultiplier ?? DEFAULT_SETTLEMENT_RULES.vulnerabilityMultiplier, 'rules.vulnerabilityMultiplier'),
    concentrationBaseDc: normalizeInteger(object.concentrationBaseDc ?? DEFAULT_SETTLEMENT_RULES.concentrationBaseDc, 'rules.concentrationBaseDc', 0, 1000),
    concentrationDamageDivisor: normalizePositiveNumber(object.concentrationDamageDivisor ?? DEFAULT_SETTLEMENT_RULES.concentrationDamageDivisor, 'rules.concentrationDamageDivisor')
  };
}

function applyTemporaryHp(current, request, rules) {
  const mode = request.mode || rules.tempHpMode;
  if (mode === 'replace' || mode === 'set') return request.amount;
  if (mode === 'add') return current + request.amount;
  return Math.max(current, request.amount);
}

function normalizeRoll(value = {}) {
  const object = normalizeObject(value);
  return {
    expression: normalizeOptionalText(object.expression || object.dice),
    total: object.total !== undefined || object.rollTotal !== undefined ? normalizeOptionalNumber(object.total ?? object.rollTotal) : undefined,
    rolls: normalizeArray(object.rolls).map((roll) => normalizeOptionalNumber(roll)).filter((roll) => roll !== undefined),
    source: normalizeOptionalText(object.source)
  };
}

function normalizeDeathSaveOutcome(value) {
  const normalized = String(value || '').trim();
  if (['success', 'failure', 'criticalSuccess', 'criticalFailure'].includes(normalized)) return normalized;
  if (['nat20', 'natural20', '20'].includes(normalized)) return 'criticalSuccess';
  if (['nat1', 'natural1', '1'].includes(normalized)) return 'criticalFailure';
  throw validationError(`Unsupported death save outcome: ${value}`);
}

function emptyDeathSaves() {
  return { successes: 0, failures: 0 };
}

function isDead(current) {
  if (current.statusBar?.deathSaves?.dead) return true;
  if (current.conditions.includes('dead')) return true;
  return current.specialStatuses.some((status) => String(status.id || status.name).toLowerCase() === 'dead' && status.active !== false);
}

function dedupeStatusUpdates(statuses) {
  const result = [];
  const seen = new Set();
  for (const status of statuses) {
    const key = `${status.id}:${status._delete ? 'delete' : 'upsert'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const clean = { ...status };
    delete clean.operation;
    delete clean.conditionName;
    result.push(clean);
  }
  return result;
}

function intersects(types, candidates) {
  if (types.has('all') || candidates.has('all')) return true;
  for (const type of types) {
    if (candidates.has(type)) return true;
  }
  return false;
}

function normalizeDamageTypeSet(value) {
  return new Set(normalizeStringArray(value).map(normalizeDamageType));
}

function normalizeDamageType(value) {
  return String(value || 'untyped').trim().toLowerCase();
}

function applyRounding(value, mode) {
  if (mode === 'ceil') return Math.ceil(value);
  if (mode === 'round') return Math.round(value);
  return Math.floor(value);
}

function normalizeArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeRequiredText(value, field) {
  const text = normalizeOptionalText(value);
  if (!text) throw validationError(`${field} is required`);
  return text;
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeSceneId(value) {
  return normalizeOptionalText(value) || 'current';
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value || '').trim().toLowerCase();
  return ['true', '1', 'yes', 'y', 'on', 'player', 'pc', 'active'].includes(normalized);
}

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw validationError(`Expected finite number: ${value}`);
  return number;
}

function normalizeNonNegativeNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw validationError(`${field} must be a non-negative number`);
  return number;
}

function normalizePositiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw validationError(`${field} must be a positive number`);
  return number;
}

function normalizeInteger(value, field, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw validationError(`${field} must be an integer between ${min} and ${max}`);
  return number;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function safeSegment(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'EffectSettlementValidationError';
  error.statusCode = 400;
  return error;
}
