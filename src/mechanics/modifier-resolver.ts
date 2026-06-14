// @ts-nocheck
export const MODIFIER_RESOLVER_REFERENCE = {
  version: 'modifier_resolver_v1',
  purpose: 'Resolve temporary buffs, debuffs, passive mechanics, equipment hints, defenses, and roll modes before dice or damage settlement.',
  noLlm: true,
  supportedUseCases: [
    'combat attack rolls',
    'ordinary skill or ability checks',
    'saving throws',
    'temporary AC / defense / dodge effects',
    'damage resistance, vulnerability, and immunity',
    'status/equipment/mechanic-driven advantage or disadvantage'
  ],
  expectedAuthoringPatterns: {
    statusMetadata: {
      attackBonus: 2,
      checkBonus: 1,
      acBonus: 2,
      incomingAttackDisadvantage: true,
      resistances: ['fire']
    },
    genericModifiers: [
      { appliesTo: 'stealth', amount: 2 },
      { checkKind: 'attack', amount: 1 },
      { stat: 'armorClass', amount: 2 },
      { damageType: 'fire', resistance: true }
    ],
    mechanicRecords: 'skill/status/feat metadata.modifiers or numericValues can provide passive values; metadata.combatAction remains the selected action payload.'
  }
};

export class ModifierResolver {
  constructor({ toolManager } = {}) {
    this.toolManager = toolManager;
  }

  describe() {
    return {
      ...MODIFIER_RESOLVER_REFERENCE,
      policy: [
        'The resolver is read-only and deterministic.',
        'It never mutates Actor state or mechanics registry records.',
        'It returns deltas and source explanations so UI/debug panels can show why a roll changed.',
        'It treats missing data as no-op for compatibility with old saves.'
      ]
    };
  }

  async resolveCheckModifiers(input = {}) {
    const request = normalizeCheckRequest(input);
    const actor = await this.resolveActor(request, 'actor');
    const target = await this.resolveActor(request, 'target');
    const actorMechanics = request.includeMechanics ? await this.collectMechanics(actor.data, 'actor') : [];
    const targetMechanics = request.includeMechanics ? await this.collectMechanics(target.data, 'target') : [];
    const targetBaseAc = resolveBaseArmorClass(target.data);
    if (isAttackLike(request) && !request.successThresholdLocked && targetBaseAc !== undefined) {
      request.base = {
        ...request.base,
        successThreshold: targetBaseAc
      };
    }
    const accumulator = createAccumulator(request.base);
    if (isAttackLike(request) && !request.successThresholdLocked && targetBaseAc !== undefined) {
      accumulator.sources.push({
        sourceType: 'target_state',
        sourceId: target.data?.npcId || request.targetId,
        field: 'baseArmorClass',
        effect: 'successThresholdBase',
        amount: targetBaseAc
      });
    }

    applyActorStateModifiers(accumulator, actor.data, request, {
      sourceType: 'actor_state',
      actorId: actor.data?.npcId || request.actorId
    });
    for (const mechanic of actorMechanics) {
      applyMechanicModifiers(accumulator, mechanic, request, 'actor');
    }

    applyTargetStateModifiers(accumulator, target.data, request, {
      sourceType: 'target_state',
      actorId: target.data?.npcId || request.targetId
    });
    for (const mechanic of targetMechanics) {
      applyMechanicModifiers(accumulator, mechanic, request, 'target');
    }

    const resolved = buildResolvedCheck(request, accumulator);
    return {
      noLlm: true,
      checkKind: request.checkKind,
      actor: compactActor(actor),
      target: compactActor(target),
      base: request.base,
      resolved,
      deltas: {
        modifier: accumulator.modifierDelta,
        successThreshold: accumulator.thresholdDelta,
        damageBonus: accumulator.damageBonus,
        advantage: accumulator.advantage,
        disadvantage: accumulator.disadvantage
      },
      defenses: accumulator.defenses,
      sources: accumulator.sources,
      missing: [...actor.missing, ...target.missing],
      mechanics: [...actorMechanics, ...targetMechanics].map(compactMechanic),
      policy: {
        deterministic: true,
        mutatesState: false,
        successThresholdLocked: request.successThresholdLocked
      }
    };
  }

  async resolveCombatModifiers(input = {}) {
    return this.resolveCheckModifiers({
      ...input,
      checkKind: input.checkKind || input.kind || 'attack'
    });
  }

  async resolveDamageDefenses(input = {}) {
    const request = normalizeDefenseRequest(input);
    const target = await this.resolveActor(request, 'target');
    const targetMechanics = request.includeMechanics ? await this.collectMechanics(target.data, 'target') : [];
    const accumulator = createAccumulator({});

    applyTargetStateModifiers(accumulator, target.data, {
      ...request,
      checkKind: 'damage',
      base: {}
    }, {
      sourceType: 'target_state',
      actorId: target.data?.npcId || request.targetId
    });
    for (const mechanic of targetMechanics) {
      applyMechanicModifiers(accumulator, mechanic, {
        ...request,
        checkKind: 'damage',
        base: {}
      }, 'target');
    }

    return {
      noLlm: true,
      target: compactActor(target),
      damageTypes: request.damageTypes,
      defenses: accumulator.defenses,
      sources: accumulator.sources,
      missing: target.missing,
      mechanics: targetMechanics.map(compactMechanic),
      policy: {
        deterministic: true,
        mutatesState: false
      }
    };
  }

  async resolveActor(request, role) {
    const supplied = role === 'actor' ? request.actor : request.target;
    const id = role === 'actor' ? request.actorId : request.targetId;
    if (supplied && typeof supplied === 'object') {
      const data = supplied.data || supplied;
      return { record: supplied, data, missing: [] };
    }
    if (!id || !request.chatSessionId || !this.toolManager?.executeTool) {
      return { record: undefined, data: undefined, missing: id ? [] : [{ role, reason: 'missing_actor_id' }] };
    }
    try {
      const result = await this.toolManager.executeTool('system.npc_state.get_state', {
        chatSessionId: request.chatSessionId,
        sceneId: request.sceneId,
        npcId: id
      });
      const record = result.output;
      return { record, data: record?.data || record, missing: [] };
    } catch (error) {
      return {
        record: undefined,
        data: undefined,
        missing: [{
          role,
          actorId: id,
          reason: 'actor_state_not_found',
          error: serializeError(error)
        }]
      };
    }
  }

  async collectMechanics(actor = {}, role = 'actor') {
    if (!actor || !this.toolManager?.executeTool) return [];
    const refs = collectMechanicRefs(actor);
    const records = [];
    for (const ref of refs) {
      const tool = mechanicTool(ref.kind);
      if (!tool) continue;
      try {
        const result = await this.toolManager.executeTool(tool, { id: ref.id });
        records.push({
          ...ref,
          role,
          record: result.output,
          data: result.output?.data || result.output
        });
      } catch {
        // Missing mechanic records are expected while users are still authoring data.
      }
    }
    return records;
  }
}

function normalizeCheckRequest(input = {}) {
  const base = normalizeBase(input.base || input.diceInput || input.check || input.attack || input);
  const actorId = normalizeOptionalText(input.actorId || input.npcId || input.playerId || input.attackerId);
  const targetId = normalizeOptionalText(input.targetId || input.targetNpcId || input.defenderId || normalizeStringArray(input.targetIds)[0]);
  return {
    chatSessionId: normalizeOptionalText(input.chatSessionId || input.chatId || input.sessionId),
    sceneId: normalizeOptionalText(input.sceneId) || 'current',
    actorId,
    targetId,
    actor: input.actor || input.actorState,
    target: input.target || input.targetState,
    checkKind: normalizeCheckKind(input.checkKind || input.kind || input.actionKind || input.type || 'check'),
    actionKind: normalizeCheckKind(input.actionKind || input.kind || input.type),
    actionId: normalizeOptionalText(input.actionId),
    ability: normalizeKey(input.ability || input.attribute || input.stat),
    skillId: normalizeKey(input.skillId || input.skill || input.proficiency),
    save: normalizeKey(input.save || input.savingThrow),
    damageTypes: normalizeDamageTypes(input.damageTypes || input.damageType || input.damage || input.damageRolls),
    sourceText: normalizeOptionalText(input.sourceText || input.text || input.content),
    base,
    successThresholdLocked: Boolean(input.successThresholdLocked || input.lockSuccessThreshold || input.lockedDc),
    includeMechanics: input.includeMechanics !== false
  };
}

function normalizeDefenseRequest(input = {}) {
  return {
    chatSessionId: normalizeOptionalText(input.chatSessionId || input.chatId || input.sessionId),
    sceneId: normalizeOptionalText(input.sceneId) || 'current',
    targetId: normalizeOptionalText(input.targetId || input.targetNpcId || input.npcId || input.actorId || input.id),
    target: input.target || input.targetState || input.actor,
    damageTypes: normalizeDamageTypes(input.damageTypes || input.damageType || input.damage || input.damageRolls),
    includeMechanics: input.includeMechanics !== false
  };
}

function normalizeBase(input = {}) {
  const object = normalizeObject(input);
  return removeUndefined({
    successThreshold: optionalNumber(object.successThreshold ?? object.dc ?? object.target ?? object.targetAc ?? object.ac),
    modifier: optionalNumber(object.modifier ?? object.fixedModifier, 0),
    buff: optionalNumber(object.buff),
    debuff: optionalNumber(object.debuff),
    abilityModifier: optionalNumber(object.abilityModifier),
    proficiencyBonus: optionalNumber(object.proficiencyBonus),
    modifiers: Array.isArray(object.modifiers) ? object.modifiers : undefined,
    rollMode: normalizeRollMode(object.rollMode),
    forceMode: normalizeOptionalText(object.forceMode),
    diceCount: optionalNumber(object.diceCount ?? object.rollCount),
    diceSides: optionalNumber(object.diceSides ?? object.sides),
    criticalMode: normalizeOptionalText(object.criticalMode),
    inspirationPoints: object.inspirationPoints
  });
}

function createAccumulator(base = {}) {
  return {
    base,
    modifierDelta: 0,
    thresholdDelta: 0,
    damageBonus: 0,
    advantage: false,
    disadvantage: false,
    defenses: {
      resistances: [],
      vulnerabilities: [],
      immunities: []
    },
    sources: []
  };
}

function applyActorStateModifiers(accumulator, actor = {}, request, sourceBase) {
  if (!actor) return;
  applyValueSource(accumulator, actor.statusBar?.modifiers, request, sourceBase);
  applyValueSource(accumulator, actor.statusBar?.checkModifiers, request, { ...sourceBase, field: 'statusBar.checkModifiers' });
  applyValueSource(accumulator, actor.statusBar?.combatModifiers, request, { ...sourceBase, field: 'statusBar.combatModifiers' });
  applyEquipmentSources(accumulator, actor.equipment, request, sourceBase);
  for (const status of normalizeArray(actor.specialStatuses)) {
    if (!isActiveStatus(status)) continue;
    const metadata = normalizeObject(status.metadata);
    applyDirectActorMetadata(accumulator, {
      ...metadata,
      stacks: status.stacks,
      intensity: status.intensity
    }, request, {
      ...sourceBase,
      sourceType: 'actor_status',
      sourceId: status.id || status.name,
      name: status.name
    });
    applyValueSource(accumulator, metadata.modifiers || metadata.checkModifiers || metadata.combatModifiers, request, {
      ...sourceBase,
      sourceType: 'actor_status',
      sourceId: status.id || status.name,
      name: status.name
    });
  }
  applySkillBarBonuses(accumulator, actor.skillBar, request, sourceBase);
}

function applyTargetStateModifiers(accumulator, target = {}, request, sourceBase) {
  if (!target) return;
  applyDefenseSets(accumulator, {
    ...(target.statusBar?.defenses || {}),
    ...(target.statusBar?.damageDefenses || {})
  }, request, {
    ...sourceBase,
    field: 'statusBar.defenses'
  });
  applyValueSource(accumulator, target.statusBar?.combatModifiers, request, { ...sourceBase, field: 'statusBar.combatModifiers', targetRole: 'target' });
  for (const status of normalizeArray(target.specialStatuses)) {
    if (!isActiveStatus(status)) continue;
    const metadata = normalizeObject(status.metadata);
    applyDirectTargetMetadata(accumulator, {
      ...metadata,
      stacks: status.stacks,
      intensity: status.intensity
    }, request, {
      ...sourceBase,
      sourceType: 'target_status',
      sourceId: status.id || status.name,
      name: status.name
    });
    applyValueSource(accumulator, metadata.modifiers || metadata.checkModifiers || metadata.combatModifiers, request, {
      ...sourceBase,
      sourceType: 'target_status',
      sourceId: status.id || status.name,
      name: status.name,
      targetRole: 'target'
    });
  }
}

function applyMechanicModifiers(accumulator, mechanic, request, role) {
  const data = normalizeObject(mechanic.data);
  const sourceBase = {
    sourceType: `${role}_mechanic`,
    sourceId: mechanic.id || data.id,
    name: data.name,
    mechanicKind: mechanic.kind,
    role
  };
  applyDirectActorMetadata(accumulator, normalizeObject(data.numericValues), request, sourceBase);
  applyDirectActorMetadata(accumulator, normalizeObject(data.metadata?.passive || data.metadata?.passiveModifiers), request, sourceBase);
  applyValueSource(accumulator, data.metadata?.modifiers || data.metadata?.checkModifiers || data.metadata?.combatModifiers || data.grants, request, sourceBase);
  if (role === 'target') {
    applyDirectTargetMetadata(accumulator, normalizeObject(data.numericValues), request, sourceBase);
    applyDefenseSets(accumulator, data.metadata?.defenses || data.defenses, request, sourceBase);
  }
}

function applySkillBarBonuses(accumulator, skillBar = {}, request, sourceBase) {
  if (!request.skillId) return;
  for (const skill of normalizeArray(skillBar.skills)) {
    const id = normalizeKey(skill.skillId || skill.id || skill.name);
    if (id !== request.skillId) continue;
    const amount = firstFiniteNumber(skill.bonus, skill.modifier, skill.rankBonus);
    if (amount === undefined) continue;
    addModifier(accumulator, amount, {
      ...sourceBase,
      sourceType: 'actor_skill_bar',
      sourceId: skill.id || skill.skillId || skill.name,
      name: skill.name,
      field: 'skillBar.skills.bonus'
    });
  }
}

function applyEquipmentSources(accumulator, equipment = {}, request, sourceBase) {
  for (const item of flattenEquipment(equipment)) {
    const metadata = normalizeObject(item.metadata);
    applyDirectActorMetadata(accumulator, metadata, request, {
      ...sourceBase,
      sourceType: 'equipment',
      sourceId: item.id || item.itemId || item.name,
      name: item.name
    });
    applyValueSource(accumulator, metadata.modifiers || item.modifiers || item.bonuses, request, {
      ...sourceBase,
      sourceType: 'equipment',
      sourceId: item.id || item.itemId || item.name,
      name: item.name
    });
  }
}

function applyDirectActorMetadata(accumulator, data = {}, request, sourceBase) {
  const stackMultiplier = data.stackModifiers === true ? Math.max(1, Number(data.stacks) || 1) : 1;
  const direct = [];
  if (isAttackLike(request)) {
    direct.push(['attackBonus', data.attackBonus], ['attackModifier', data.attackModifier], ['toHitBonus', data.toHitBonus], ['hitBonus', data.hitBonus]);
  }
  if (isCheckLike(request)) {
    direct.push(['checkBonus', data.checkBonus], ['allCheckBonus', data.allCheckBonus]);
  }
  if (request.checkKind === 'save' || request.save) {
    direct.push(['saveBonus', data.saveBonus], ['savingThrowBonus', data.savingThrowBonus]);
    const saveMap = normalizeObject(data.saveModifiers || data.savingThrowModifiers);
    direct.push([`save:${request.save || request.ability}`, saveMap[request.save || request.ability]]);
  }
  if (request.ability) {
    const abilityMap = normalizeObject(data.abilityModifiers || data.abilities);
    direct.push([`ability:${request.ability}`, abilityMap[request.ability]], [`${request.ability}Bonus`, data[`${request.ability}Bonus`]]);
  }
  if (request.skillId) {
    const skillMap = normalizeObject(data.skillModifiers || data.skills);
    direct.push([`skill:${request.skillId}`, skillMap[request.skillId]]);
  }
  if (request.checkKind === 'damage') {
    direct.push(['damageBonus', data.damageBonus], ['damageModifier', data.damageModifier]);
  }
  for (const [field, value] of direct) {
    const amount = firstFiniteNumber(value);
    if (amount !== undefined) addModifier(accumulator, amount * stackMultiplier, { ...sourceBase, field });
  }
  applyRollMode(accumulator, data, request, sourceBase);
}

function applyRollMode(accumulator, data = {}, request, sourceBase) {
  const modes = [
    ['rollMode', data.rollMode],
    ['checkRollMode', data.checkRollMode],
    ['diceRollMode', data.diceRollMode]
  ];
  const advantageFlags = [
    ['advantage', data.advantage],
    ['hasAdvantage', data.hasAdvantage],
    ['checkAdvantage', data.checkAdvantage],
    ['allCheckAdvantage', data.allCheckAdvantage]
  ];
  const disadvantageFlags = [
    ['disadvantage', data.disadvantage],
    ['hasDisadvantage', data.hasDisadvantage],
    ['checkDisadvantage', data.checkDisadvantage],
    ['allCheckDisadvantage', data.allCheckDisadvantage]
  ];

  if (isAttackLike(request)) {
    modes.push(['attackRollMode', data.attackRollMode], ['toHitRollMode', data.toHitRollMode]);
    advantageFlags.push(['attackAdvantage', data.attackAdvantage], ['toHitAdvantage', data.toHitAdvantage]);
    disadvantageFlags.push(['attackDisadvantage', data.attackDisadvantage], ['toHitDisadvantage', data.toHitDisadvantage]);
  }
  if (request.checkKind === 'save' || request.save) {
    modes.push(['saveRollMode', data.saveRollMode], ['savingThrowRollMode', data.savingThrowRollMode]);
    advantageFlags.push(['saveAdvantage', data.saveAdvantage], ['savingThrowAdvantage', data.savingThrowAdvantage]);
    disadvantageFlags.push(['saveDisadvantage', data.saveDisadvantage], ['savingThrowDisadvantage', data.savingThrowDisadvantage]);
    if (request.save || request.ability) {
      const key = request.save || request.ability;
      advantageFlags.push([`${key}SaveAdvantage`, data[`${key}SaveAdvantage`]]);
      disadvantageFlags.push([`${key}SaveDisadvantage`, data[`${key}SaveDisadvantage`]]);
    }
  }
  if (request.skillId) {
    const skillModes = normalizeObject(data.skillRollModes || data.skillModes);
    modes.push([`skill:${request.skillId}:rollMode`, skillModes[request.skillId]]);
  }
  if (request.ability) {
    const abilityModes = normalizeObject(data.abilityRollModes || data.abilityModes);
    modes.push([`ability:${request.ability}:rollMode`, abilityModes[request.ability]]);
  }

  for (const [field, value] of modes) {
    const mode = normalizeRollMode(value);
    if (mode === 'advantage') addAdvantage(accumulator, { ...sourceBase, field });
    if (mode === 'disadvantage') addDisadvantage(accumulator, { ...sourceBase, field });
  }
  for (const [field, value] of advantageFlags) {
    if (truthy(value)) addAdvantage(accumulator, { ...sourceBase, field });
  }
  for (const [field, value] of disadvantageFlags) {
    if (truthy(value)) addDisadvantage(accumulator, { ...sourceBase, field });
  }
}

function applyDirectTargetMetadata(accumulator, data = {}, request, sourceBase) {
  const stackMultiplier = data.stackModifiers === true ? Math.max(1, Number(data.stacks) || 1) : 1;
  if (isAttackLike(request)) {
    const acBonus = firstFiniteNumber(data.acBonus, data.armorClassBonus, data.defenseBonus, data.incomingAttackDcBonus);
    if (acBonus !== undefined && !request.successThresholdLocked) {
      addThreshold(accumulator, acBonus * stackMultiplier, { ...sourceBase, field: 'acBonus' });
    }
    if (truthy(data.incomingAttackDisadvantage) || truthy(data.attacksAgainstDisadvantage)) {
      addDisadvantage(accumulator, { ...sourceBase, field: 'incomingAttackDisadvantage' });
    }
    if (truthy(data.incomingAttackAdvantage) || truthy(data.attacksAgainstAdvantage)) {
      addAdvantage(accumulator, { ...sourceBase, field: 'incomingAttackAdvantage' });
    }
  }
  applyDefenseSets(accumulator, data.defenses || data.damageDefenses || data, request, sourceBase);
}

function applyValueSource(accumulator, value, request, sourceBase) {
  for (const spec of normalizeModifierSpecs(value)) {
    if (!modifierApplies(spec, request)) continue;
    const field = normalizeOptionalText(spec.field || spec.stat || spec.kind || spec.type || spec.appliesTo);
    const amount = firstFiniteNumber(spec.amount, spec.value, spec.bonus, spec.modifier, spec.acBonus, spec.defenseBonus, spec.attackBonus, spec.checkBonus);
    const targetRole = normalizeOptionalText(spec.targetRole || spec.target || sourceBase.targetRole);
    const lowerField = normalizeKey(field);
    if (['armorclass', 'ac', 'defense', 'dc', 'successthreshold'].includes(lowerField) || targetRole === 'target') {
      if (amount !== undefined && !request.successThresholdLocked) addThreshold(accumulator, amount, { ...sourceBase, field });
    } else if (amount !== undefined) {
      addModifier(accumulator, amount, { ...sourceBase, field });
    }
    if (truthy(spec.advantage) || normalizeRollMode(spec.rollMode) === 'advantage') addAdvantage(accumulator, { ...sourceBase, field: field || 'advantage' });
    if (truthy(spec.disadvantage) || normalizeRollMode(spec.rollMode) === 'disadvantage') addDisadvantage(accumulator, { ...sourceBase, field: field || 'disadvantage' });
    applyDefenseSets(accumulator, spec, request, sourceBase);
  }
}

function applyDefenseSets(accumulator, data = {}, request, sourceBase) {
  const source = normalizeObject(data);
  const resistances = normalizeStringArray(source.resistances || source.resistance);
  const vulnerabilities = normalizeStringArray(source.vulnerabilities || source.vulnerability);
  const immunities = normalizeStringArray(source.immunities || source.immunity);
  for (const value of resistances) addDefense(accumulator, 'resistances', value, sourceBase);
  for (const value of vulnerabilities) addDefense(accumulator, 'vulnerabilities', value, sourceBase);
  for (const value of immunities) addDefense(accumulator, 'immunities', value, sourceBase);
  if (truthy(source.resistance) && source.damageType) addDefense(accumulator, 'resistances', source.damageType, sourceBase);
  if (truthy(source.vulnerability) && source.damageType) addDefense(accumulator, 'vulnerabilities', source.damageType, sourceBase);
  if (truthy(source.immunity) && source.damageType) addDefense(accumulator, 'immunities', source.damageType, sourceBase);
}

function addModifier(accumulator, amount, source) {
  accumulator.modifierDelta += amount;
  accumulator.sources.push({ ...compactSource(source), effect: 'modifier', amount });
}

function addThreshold(accumulator, amount, source) {
  accumulator.thresholdDelta += amount;
  accumulator.sources.push({ ...compactSource(source), effect: 'successThreshold', amount });
}

function addAdvantage(accumulator, source) {
  accumulator.advantage = true;
  accumulator.sources.push({ ...compactSource(source), effect: 'advantage', amount: 1 });
}

function addDisadvantage(accumulator, source) {
  accumulator.disadvantage = true;
  accumulator.sources.push({ ...compactSource(source), effect: 'disadvantage', amount: 1 });
}

function addDefense(accumulator, key, value, source) {
  const normalized = normalizeKey(value);
  if (!normalized) return;
  if (!accumulator.defenses[key].includes(normalized)) accumulator.defenses[key].push(normalized);
  accumulator.sources.push({ ...compactSource(source), effect: key, value: normalized });
}

function buildResolvedCheck(request, accumulator) {
  const base = request.base;
  const baseThreshold = base.successThreshold;
  const threshold = baseThreshold === undefined || request.successThresholdLocked
    ? baseThreshold
    : baseThreshold + accumulator.thresholdDelta;
  const modifier = (Number(base.modifier) || 0) + accumulator.modifierDelta;
  const rollMode = combineRollMode(base.rollMode, accumulator);
  return removeUndefined({
    ...base,
    successThreshold: threshold,
    modifier,
    rollMode,
    modifierBreakdown: {
      baseModifier: Number(base.modifier) || 0,
      modifierDelta: accumulator.modifierDelta,
      baseSuccessThreshold: baseThreshold,
      successThresholdDelta: request.successThresholdLocked ? 0 : accumulator.thresholdDelta,
      advantage: accumulator.advantage,
      disadvantage: accumulator.disadvantage
    }
  });
}

function resolveBaseArmorClass(actor = {}) {
  if (!actor) return undefined;
  const values = normalizeObject(actor.values);
  const statusBar = normalizeObject(actor.statusBar);
  return firstFiniteNumber(
    actor.armorClass,
    actor.ac,
    values.armorClass,
    values.ac,
    statusBar.armorClass,
    statusBar.ac
  );
}

function combineRollMode(baseRollMode, accumulator) {
  const base = normalizeRollMode(baseRollMode);
  let advantage = accumulator.advantage || base === 'advantage';
  let disadvantage = accumulator.disadvantage || base === 'disadvantage';
  if (advantage && disadvantage) return 'normal';
  if (advantage) return 'advantage';
  if (disadvantage) return 'disadvantage';
  return base || 'normal';
}

function collectMechanicRefs(actor = {}) {
  const refs = [];
  const push = (kind, id, source) => {
    const normalizedKind = normalizeMechanicKind(kind);
    const normalizedId = normalizeOptionalText(id);
    if (!normalizedKind || !normalizedId) return;
    refs.push({ kind: normalizedKind, id: normalizedId, source });
  };
  for (const action of [
    ...normalizeArray(actor.skillBar?.actions),
    ...normalizeArray(actor.skillBar?.spells),
    ...normalizeArray(actor.statusBar?.specialSkills)
  ]) {
    push(action.mechanicKind || (action.featId ? 'feat' : action.statusId ? 'status' : action.skillId ? 'skill' : ''), action.mechanicId || action.skillId || action.featId || action.statusId || action.id, 'action');
  }
  for (const skill of normalizeArray(actor.skillBar?.skills)) {
    push('skill', skill.skillId || skill.mechanicId || skill.registryId || prefixedRegistryId(skill.id, ['skill_', 'spell_']), 'skillBar.skills');
  }
  for (const skill of [...normalizeArray(actor.resources?.combat?.skillIds), ...normalizeArray(actor.resources?.combat?.skills)]) {
    push('skill', typeof skill === 'string' ? skill : skill.skillId || skill.id, 'resources.combat.skills');
  }
  for (const feat of [...normalizeArray(actor.skillBar?.feats), ...normalizeArray(actor.statusBar?.feats), ...normalizeArray(actor.resources?.combat?.featIds), ...normalizeArray(actor.resources?.combat?.feats)]) {
    push('feat', typeof feat === 'string' ? feat : feat.featId || feat.id, 'feat_refs');
  }
  for (const status of normalizeArray(actor.specialStatuses)) {
    push('status', status.statusId || status.mechanicId || status.registryId || prefixedRegistryId(status.id, ['status_']), 'specialStatuses');
  }
  for (const status of [...normalizeArray(actor.resources?.combat?.statusIds), ...normalizeArray(actor.resources?.combat?.statuses)]) {
    push('status', typeof status === 'string' ? status : status.statusId || status.id, 'resources.combat.statuses');
  }
  const seen = new Set();
  return refs.filter((ref) => {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function prefixedRegistryId(value, prefixes = []) {
  const id = normalizeOptionalText(value);
  return id && prefixes.some((prefix) => id.startsWith(prefix)) ? id : '';
}

function normalizeModifierSpecs(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap(normalizeModifierSpecs);
  if (typeof value !== 'object') return [];
  return Object.entries(value).some(([, entry]) => typeof entry === 'object' && entry !== null && !Array.isArray(entry))
    ? Object.entries(value).map(([key, entry]) => ({ field: key, ...normalizeObject(entry) }))
    : [value];
}

function modifierApplies(spec = {}, request) {
  const tokens = normalizeStringArray(spec.appliesTo || spec.applies || spec.context || spec.tags).map(normalizeKey);
  if (tokens.length && !tokens.some((token) => contextTokens(request).has(token))) return false;
  const checkKind = normalizeCheckKind(spec.checkKind || spec.kind);
  if (checkKind && checkKind !== 'custom' && checkKind !== request.checkKind) return false;
  const ability = normalizeKey(spec.ability || spec.attribute || spec.statAbility);
  if (ability && request.ability && ability !== request.ability) return false;
  const skill = normalizeKey(spec.skillId || spec.skill);
  if (skill && request.skillId && skill !== request.skillId) return false;
  const damageType = normalizeKey(spec.damageType);
  if (damageType && request.damageTypes.length && !request.damageTypes.includes(damageType)) return false;
  return true;
}

function contextTokens(request) {
  return new Set([
    request.checkKind,
    request.actionKind,
    request.ability,
    request.skillId,
    request.save,
    request.actionId,
    ...request.damageTypes
  ].filter(Boolean).map(normalizeKey));
}

function isAttackLike(request) {
  return ['attack', 'combat_attack', 'weapon_attack', 'spell_attack'].includes(request.checkKind)
    || ['attack', 'combat_attack'].includes(request.actionKind);
}

function isCheckLike(request) {
  return !['damage'].includes(request.checkKind);
}

function mechanicTool(kind) {
  if (kind === 'skill') return 'system.mechanics_registry.get_skill';
  if (kind === 'feat') return 'system.mechanics_registry.get_feat';
  if (kind === 'status') return 'system.mechanics_registry.get_status';
  return '';
}

function normalizeMechanicKind(value) {
  const normalized = normalizeKey(value);
  if (['skill', 'skills', 'ability', 'abilities'].includes(normalized)) return 'skill';
  if (['feat', 'feats', 'perk', 'perks', 'trait', 'traits'].includes(normalized)) return 'feat';
  if (['status', 'statuses', 'condition', 'conditions', 'effect', 'effects'].includes(normalized)) return 'status';
  return '';
}

function normalizeCheckKind(value) {
  const normalized = normalizeKey(value);
  if (['attacks', 'hit', 'tohit', 'strike'].includes(normalized)) return 'attack';
  if (['savingthrow', 'saving_throw', 'save'].includes(normalized)) return 'save';
  if (['skillcheck', 'skill_check'].includes(normalized)) return 'skill';
  if (['abilitycheck', 'ability_check'].includes(normalized)) return 'ability';
  if (['defend', 'defense', 'dodge', 'guard'].includes(normalized)) return 'defense';
  return normalized || 'check';
}

function normalizeDamageTypes(...values) {
  return normalizeArray(values.flat())
    .flatMap((item) => {
      if (typeof item === 'string') return item.split(',');
      if (item && typeof item === 'object') return [item.type, item.damageType, item.element];
      return [];
    })
    .map(normalizeKey)
    .filter(Boolean);
}

function flattenEquipment(equipment = {}) {
  const out = [];
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== 'object') return;
    if (value.id || value.itemId || value.name || value.metadata || value.modifiers || value.bonuses) out.push(value);
    for (const key of ['weapons', 'armor', 'accessories', 'rings', 'quickSlots', 'equipped']) {
      if (value[key]) visit(value[key]);
    }
  };
  visit(equipment);
  return out;
}

function compactActor(entry = {}) {
  const data = entry.data || {};
  if (!data) return undefined;
  return removeUndefined({
    actorId: data.npcId || data.actorId,
    name: data.name,
    actorType: data.actorType,
    isPlayer: data.isPlayer,
    sceneId: data.sceneId,
    recordId: entry.record?.id || entry.id
  });
}

function compactMechanic(mechanic = {}) {
  return removeUndefined({
    kind: mechanic.kind,
    id: mechanic.id,
    role: mechanic.role,
    source: mechanic.source,
    name: mechanic.data?.name
  });
}

function compactSource(source = {}) {
  return removeUndefined({
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    name: source.name,
    field: source.field,
    role: source.role,
    mechanicKind: source.mechanicKind,
    actorId: source.actorId
  });
}

function isActiveStatus(status = {}) {
  if (!status || typeof status !== 'object') return false;
  if (status.active === false) return false;
  if (status._delete === true) return false;
  if (status.remainingTurns !== undefined && Number(status.remainingTurns) <= 0) return false;
  return true;
}

function truthy(value) {
  return value === true || value === 'true' || value === 1 || value === '1' || value === 'yes';
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function optionalNumber(value, fallback) {
  const number = firstFiniteNumber(value);
  return number === undefined ? fallback : number;
}

function normalizeRollMode(value) {
  const normalized = normalizeKey(value);
  if (['advantage', 'adv'].includes(normalized)) return 'advantage';
  if (['disadvantage', 'disadv'].includes(normalized)) return 'disadvantage';
  if (['normal', 'none'].includes(normalized)) return 'normal';
  return normalized;
}

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap(normalizeStringArray);
  return String(value).split(',').map((entry) => entry.trim()).filter(Boolean);
}

function normalizeArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeKey(value) {
  return normalizeOptionalText(value).toLowerCase().replace(/[^a-z0-9_\u4e00-\u9fff.-]+/g, '_');
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ''));
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    statusCode: error?.statusCode
  };
}
