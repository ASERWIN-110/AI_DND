// @ts-nocheck
import { createId } from '../utils/id.js';
import {
  COMBAT_ACTION_TABLE_REFERENCE,
  COMBAT_ACTION_TABLE_TEMPLATE,
  normalizeCombatActionTable
} from './combat-action-table.js';

export const RPG_COMBAT_ENEMY_OBJECT_REFERENCE = {
  version: 'rpg_combat_enemy_object_v1',
  purpose: 'Numeric enemy object for standalone RPG/D&D-like combat. AI may create or select this object before battle; ordinary combat then runs without AI.',
  boundaries: {
    aiEntry: [
      'generate or call an enemy object when combat starts',
      'judge special non-numeric combat requests',
      'receive battle result for later narrative consequences'
    ],
    noAiCombat: [
      'attack roll and hit judgement',
      'damage, healing, resistance, vulnerability, immunity',
      'temporary HP, death saves, concentration',
      'buff/debuff duration and periodic effects',
      'action economy, resources, ammo, cooldowns, consumables',
      'ordinary enemy action selection: attack, defense, or dodge'
    ]
  },
  requiredNumericCore: {
    values: 'hp, maxHp, armorClass/ac, speed, and optional ability/save modifiers.',
    defenses: 'resistances, vulnerabilities, immunities. These are used by damage settlement.',
    resources: 'action economy and custom resources. Undefined resources default to standard action/bonus/reaction/movement.',
    combatMechanics: 'SQLite mechanics registry records for ordinary combat skills, feats, and statuses. Each ordinary option should include metadata.combatAction with mode, weight, and numeric payload.',
    skillBar: 'NPC state references to generated mechanics. skillBar.actions points at skill ids; resources.combat.featIds/statusIds point at feat/status ids.',
    normalActionPolicy: 'Legacy fallback hidden policy. It is used only if the actor has no state/mechanics combat candidates.'
  },
  specialHooks: 'Only textual or impossible abilities that cannot be represented numerically. These are routed to special combat judgement, not executed by ordinary combat.',
  actionPolicyReference: COMBAT_ACTION_TABLE_REFERENCE
};

export const RPG_COMBAT_ENEMY_OBJECT_TEMPLATE = {
  enemyId: 'npc_bandit_01',
  name: 'Bandit',
  actorType: 'monster',
  threatTier: 'trained',
  sceneId: 'current',
  values: {
    hp: 12,
    maxHp: 12,
    armorClass: 13,
    speed: 30,
    attackModifier: 4
  },
  statusBar: {
    defenses: {
      resistances: [],
      vulnerabilities: [],
      immunities: []
    }
  },
  resources: {
    combat: {
      skillIds: ['skill_bandit_scimitar'],
      featIds: ['feat_bandit_guarded_stance'],
      statusIds: ['status_bandit_evasive_step']
    }
  },
  combatMechanics: {
    skills: [
      {
        id: 'skill_bandit_scimitar',
        name: 'Scimitar Slash',
        category: 'combat',
        numericValues: { weight: 70 },
        metadata: {
          combatAction: {
            mode: 'attack',
            weight: 70,
            modifier: 4,
            damage: [{ type: 'slashing', amount: 4 }]
          }
        }
      }
    ],
    feats: [
      {
        id: 'feat_bandit_guarded_stance',
        name: 'Guarded Stance',
        category: 'combat',
        numericValues: { weight: 20 },
        metadata: {
          combatAction: {
            mode: 'defense',
            weight: 20,
            acBonus: 2,
            temporaryHp: 2,
            durationRounds: 1
          }
        }
      }
    ],
    statuses: [
      {
        id: 'status_bandit_evasive_step',
        name: 'Evasive Step',
        category: 'combat',
        numericValues: { weight: 10 },
        metadata: {
          combatAction: {
            mode: 'dodge',
            weight: 10,
            acBonus: 3,
            durationRounds: 1
          }
        }
      }
    ]
  },
  skillBar: {
    actions: [
      { id: 'skill_bandit_scimitar', name: 'Scimitar Slash', mechanicKind: 'skill', skillId: 'skill_bandit_scimitar' }
    ]
  },
  specialStatuses: [],
  inventory: {
    currency: {},
    items: []
  },
  equipment: {},
  normalActionPolicy: COMBAT_ACTION_TABLE_TEMPLATE,
  specialHooks: [
    {
      id: 'example_textual_hook',
      trigger: 'Only when player asks for a non-standard interaction.',
      description: 'Textual ability that requires LLM judgement because it is not numeric.'
    }
  ],
  lootHints: [],
  plotTags: [],
  metadata: {}
};

export function buildEnemyObjectPrompt({
  enemy = {},
  actor = {},
  settingText = '',
  sourceText = '',
  text = '',
  content = '',
  context = {},
  userReference = '',
  numericReference = '',
  reference = RPG_COMBAT_ENEMY_OBJECT_REFERENCE,
  template = RPG_COMBAT_ENEMY_OBJECT_TEMPLATE
} = {}) {
  return [
    'Create or normalize one RPG enemy object for a standalone battle UI.',
    'AI is only responsible for this pre-battle enemy object. Once the object is numeric, ordinary battle must run without AI.',
    'Create compact combatMechanics records for ordinary enemy options. These records are written to system.mechanics_registry before the NPC state is spawned.',
    'For each ordinary option, include metadata.combatAction with mode attack/defense/dodge, a weight, and numeric payload such as attack modifier, damage, acBonus, or temporaryHp.',
    'Reference generated skills from skillBar.actions. Reference generated feats/statuses from resources.combat.featIds/statusIds. normalActionPolicy is only a legacy fallback.',
    'Put impossible, social, reality-bending, or textual abilities into specialHooks instead of trying to execute them numerically.',
    'Return JSON only.',
    userReference || numericReference ? `User numeric/reference rules:\n${userReference || numericReference}` : '',
    'Enemy / actor setting:',
    JSON.stringify({ enemy, actor, settingText: settingText || sourceText || text || content }, null, 2),
    'Current scene and battle context:',
    JSON.stringify(context || {}, null, 2),
    'Reference:',
    JSON.stringify(reference, null, 2),
    'Return one enemy object using this shape:',
    JSON.stringify(template, null, 2)
  ].filter(Boolean).join('\n\n');
}

export function normalizeEnemyObject(input = {}, { sceneId = 'current' } = {}) {
  const source = normalizeObject(input.enemy || input.enemyObject || input.combatant || input.actor || input);
  const enemyId = safeSegment(source.enemyId || source.npcId || source.actorId || source.id || source.name || createId('enemy'));
  const threatTier = normalizeOptionalText(source.threatTier || source.tier || source.rank) || 'custom';
  const rawValues = {
    ...normalizeObject(source.values || source.numericValues),
    hp: source.hp ?? source.currentHp ?? source.values?.hp,
    maxHp: source.maxHp ?? source.values?.maxHp,
    armorClass: source.armorClass ?? source.ac ?? source.values?.armorClass ?? source.values?.ac,
    speed: source.speed ?? source.values?.speed
  };
  const values = normalizeNumericValues(rawValues);
  const hp = firstFiniteNumber(values.hp, values.currentHp, source.currentHp, values.maxHp, source.maxHp, 10);
  const maxHp = Math.max(hp, firstFiniteNumber(values.maxHp, source.maxHp, hp));
  const armorClass = firstFiniteNumber(values.armorClass, values.ac, source.armorClass, source.ac, 10);
  values.hp = clampNumber(hp, 0, 1_000_000_000);
  values.maxHp = clampNumber(maxHp, 1, 1_000_000_000);
  values.armorClass = clampNumber(armorClass, 0, 1_000_000);
  values.ac = values.armorClass;
  values.speed = clampNumber(firstFiniteNumber(values.speed, source.speed, 30), 0, 1_000_000);

  const statusBar = normalizeObject(source.statusBar);
  const defenses = normalizeDefenses(source.defenses || source.damageDefenses || statusBar.defenses || statusBar.damageDefenses);
  const actionPolicy = normalizeCombatActionTable(
    source.normalActionPolicy || source.actionPolicy || source.actionTable || source.table || {
      actorId: enemyId,
      threatTier,
      source: source.source || 'enemy-object-default'
    },
    { actorId: enemyId }
  );
  const combatMechanics = normalizeCombatMechanics(source, { enemyId });
  const skillBar = normalizeSkillBar(source.skillBar, combatMechanics);
  const resources = normalizeCombatResources(source.resources, combatMechanics);

  return {
    enemyId,
    npcId: enemyId,
    actorId: enemyId,
    name: normalizeOptionalText(source.name || source.title) || enemyId,
    actorType: normalizeOptionalText(source.actorType || source.type) || 'monster',
    isPlayer: false,
    sceneId: normalizeOptionalText(source.sceneId) || sceneId || 'current',
    threatTier,
    values,
    statusBar: {
      ...statusBar,
      defenses,
      combat: {
        ...normalizeObject(statusBar.combat),
        threatTier,
        normalActionPolicyId: actionPolicy.actionTableId
      }
    },
    resources,
    skillBar,
    specialStatuses: normalizeStatusList(source.specialStatuses || source.statuses),
    inventory: normalizeInventory(source.inventory),
    equipment: normalizeObject(source.equipment),
    defenses,
    combatMechanics,
    normalActionPolicy: actionPolicy,
    actionPolicy,
    specialHooks: normalizeArray(source.specialHooks || source.specialAbilities || source.specials)
      .map(normalizeSpecialHook)
      .filter(Boolean),
    lootHints: normalizeArray(source.lootHints || source.loot || source.rewards).map(normalizeLooseObject),
    plotTags: normalizeStringArray(source.plotTags || source.tags),
    metadata: normalizeObject(source.metadata)
  };
}

export function buildEnemyStatePatch(enemyObject = {}, { chatSessionId, sceneId, source = 'combat-enemy-object' } = {}) {
  const enemy = normalizeEnemyObject(enemyObject, { sceneId });
  return {
    chatSessionId: normalizeRequiredText(chatSessionId, 'chatSessionId'),
    sceneId: normalizeOptionalText(sceneId || enemy.sceneId) || 'current',
    npcId: enemy.enemyId,
    actorType: enemy.actorType,
    isPlayer: false,
    name: enemy.name,
    values: enemy.values,
    statusBar: enemy.statusBar,
    skillBar: enemy.skillBar,
    specialStatuses: enemy.specialStatuses,
    inventory: enemy.inventory,
    equipment: enemy.equipment,
    resources: {
      ...enemy.resources,
      combat: {
        ...normalizeObject(enemy.resources.combat),
        threatTier: enemy.threatTier,
        defenses: enemy.defenses,
        normalActionPolicy: enemy.normalActionPolicy,
        mechanicSkillIds: enemy.combatMechanics.skills.map((skill) => skill.id),
        mechanicFeatIds: enemy.combatMechanics.feats.map((feat) => feat.id),
        mechanicStatusIds: enemy.combatMechanics.statuses.map((status) => status.id),
        specialHooks: enemy.specialHooks,
        lootHints: enemy.lootHints,
        plotTags: enemy.plotTags
      }
    },
    source
  };
}

export function buildOrdinaryDefensePatch({
  chatSessionId,
  sceneId = 'current',
  actorId,
  mode,
  payload = {},
  source = 'combat-ordinary-turn'
} = {}) {
  const normalizedMode = normalizeMode(mode);
  if (!['defense', 'dodge'].includes(normalizedMode)) {
    throw validationError('ordinary defense patch mode must be defense or dodge');
  }
  const duration = clampNumber(payload.durationRounds ?? payload.remainingTurns ?? payload.rounds ?? 1, 0, 10_000);
  const acBonus = clampNumber(payload.acBonus ?? payload.defenseBonus ?? payload.dodgeBonus ?? 0, 0, 1_000_000);
  const statusId = normalizedMode === 'dodge' ? 'dodging' : 'defending';
  const statusName = normalizedMode === 'dodge' ? 'Dodging' : 'Defending';
  const metadata = {
    mode: normalizedMode,
    acBonus,
    temporaryHp: clampNumber(payload.temporaryHp ?? payload.tempHp ?? 0, 0, 1_000_000),
    damageReduction: clampNumber(payload.damageReduction ?? payload.reduction ?? 0, 0, 1_000_000),
    incomingAttackDisadvantage: payload.incomingAttackDisadvantage === true,
    dexSaveAdvantage: payload.dexSaveAdvantage === true,
    durationTiming: payload.durationTiming || 'endTurn',
    durationActorId: actorId,
    ...normalizeObject(payload.metadata)
  };
  return {
    chatSessionId: normalizeRequiredText(chatSessionId, 'chatSessionId'),
    sceneId: normalizeOptionalText(sceneId) || 'current',
    npcId: normalizeRequiredText(actorId, 'actorId'),
    statusBar: {
      combatModifiers: {
        [statusId]: {
          active: true,
          acBonus,
          damageReduction: metadata.damageReduction,
          incomingAttackDisadvantage: metadata.incomingAttackDisadvantage,
          dexSaveAdvantage: metadata.dexSaveAdvantage,
          remainingTurns: duration
        }
      }
    },
    specialStatuses: [
      {
        id: statusId,
        name: statusName,
        active: true,
        remainingTurns: duration,
        source,
        description: normalizedMode === 'dodge'
          ? 'Ordinary combat dodge stance.'
          : 'Ordinary combat defense stance.',
        metadata
      },
      ...normalizeStatusList(payload.statusEffects || payload.statuses)
    ],
    source
  };
}

export function summarizeBattleForAi({
  battle,
  events = [],
  actors = [],
  outcome,
  maxEvents = 12
} = {}) {
  const battleData = normalizeRecordData(battle);
  const actorData = normalizeArray(actors).map(normalizeRecordData);
  const eventData = normalizeArray(events).map(normalizeRecordData);
  const latestEvents = eventData.slice(-maxEvents).map((event) => ({
    eventType: event.eventType,
    actorId: event.actorId,
    targetIds: normalizeStringArray(event.targetIds),
    summary: event.summary,
    result: compactEventResult(event.result)
  }));
  const actorSummaries = actorData.map((actor) => ({
    actorId: actor.npcId || actor.actorId || actor.id,
    name: actor.name,
    actorType: actor.actorType,
    isPlayer: actor.isPlayer === true,
    hp: firstFiniteNumber(actor.values?.hp, actor.statusBar?.hp, 0),
    maxHp: firstFiniteNumber(actor.values?.maxHp, actor.statusBar?.maxHp, 0),
    temporaryHp: firstFiniteNumber(actor.values?.temporaryHp, actor.statusBar?.temporaryHp, 0),
    conditions: normalizeStringArray(actor.statusBar?.conditions),
    statuses: normalizeArray(actor.specialStatuses).map((status) => ({
      id: status.id,
      name: status.name,
      remainingTurns: status.remainingTurns,
      active: status.active !== false
    }))
  }));
  const defeatedActors = actorSummaries.filter((actor) => actor.hp <= 0 || actor.conditions.includes('dead'));
  const summary = {
    battleId: battleData.battleId,
    sceneId: battleData.sceneId,
    name: battleData.name,
    outcome: normalizeOptionalText(outcome || battleData.status) || 'ended',
    objective: battleData.objective,
    stakes: battleData.stakes,
    participantIds: normalizeStringArray(battleData.participantIds),
    allyIds: normalizeStringArray(battleData.allyIds),
    enemyIds: normalizeStringArray(battleData.enemyIds),
    defeatedActorIds: defeatedActors.map((actor) => actor.actorId).filter(Boolean),
    actors: actorSummaries,
    latestEvents,
    eventCount: eventData.length,
    llmUsedForOrdinaryCombat: false
  };
  return {
    summary,
    aiContext: [
      `Battle ${summary.battleId || summary.name || ''} ended as ${summary.outcome}.`.trim(),
      summary.objective ? `Objective: ${summary.objective}` : '',
      summary.stakes ? `Stakes: ${summary.stakes}` : '',
      defeatedActors.length ? `Defeated actors: ${summary.defeatedActorIds.join(', ')}` : '',
      `Ordinary combat was resolved numerically without LLM. Use this result only for aftermath, rewards, and world consequences.`
    ].filter(Boolean).join('\n')
  };
}

function compactEventResult(result = {}) {
  const object = normalizeObject(result);
  return {
    ok: object.ok,
    status: object.status,
    selectedMode: object.selected?.mode || object.ordinaryAction?.selected?.mode,
    attack: object.attack ? {
      outcome: object.attack.outcome,
      hit: object.attack.hit,
      critical: object.attack.critical || object.attack.criticalSuccess,
      total: object.attack.total
    } : undefined,
    damage: normalizeArray(object.damage).map((item) => ({
      type: item.type,
      amount: item.amount
    })),
    settlementTotals: object.settlement ? {
      totalDamage: object.settlement.totalDamage,
      totalHealing: object.settlement.totalHealing
    } : undefined
  };
}

function normalizeRecordData(value = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value) && value.data) return value.data;
  return normalizeObject(value);
}

function normalizeDefenses(value = {}) {
  const source = normalizeObject(value);
  return {
    resistances: normalizeStringArray(source.resistances || source.resistance),
    vulnerabilities: normalizeStringArray(source.vulnerabilities || source.vulnerability),
    immunities: normalizeStringArray(source.immunities || source.immunity)
  };
}

function normalizeCombatMechanics(source = {}, { enemyId } = {}) {
  const registry = normalizeObject(source.combatMechanics || source.mechanicsRegistry || source.generatedMechanics || source.mechanics);
  return {
    skills: normalizeMechanicRecords(
      registry.skills || registry.skill || source.combatSkills || [],
      'skill',
      { enemyId }
    ),
    feats: normalizeMechanicRecords(
      registry.feats || registry.feat || source.combatFeats || [],
      'feat',
      { enemyId }
    ),
    statuses: normalizeMechanicRecords(
      registry.statuses || registry.status || source.combatStatuses || [],
      'status',
      { enemyId }
    )
  };
}

function normalizeMechanicRecords(value = [], kind, { enemyId } = {}) {
  return normalizeArray(value)
    .filter((record) => record && typeof record === 'object' && !Array.isArray(record))
    .map((record, index) => normalizeMechanicRecord(record, kind, { enemyId, index }))
    .filter(Boolean);
}

function normalizeMechanicRecord(record = {}, kind, { enemyId, index = 0 } = {}) {
  const source = normalizeObject(record);
  const rawName = normalizeOptionalText(source.name || source.title || source.label);
  const rawId = normalizeOptionalText(source.id || source[`${kind}Id`] || source.mechanicId);
  const id = safeSegment(rawId || [enemyId, kind, rawName || index + 1].filter(Boolean).join('_'));
  const numericValues = {
    ...normalizeNumericValues(source.numericValues || source.values || source.numericSettings),
    ...(source.weight !== undefined ? { weight: normalizeOptionalNumber(source.weight) } : {})
  };
  const combatAction = normalizeCombatMechanicAction(source, numericValues);
  if (combatAction.weight !== undefined && numericValues.weight === undefined) {
    numericValues.weight = normalizeOptionalNumber(combatAction.weight);
  }
  const metadata = normalizeObject(source.metadata);
  if (Object.keys(combatAction).length) metadata.combatAction = combatAction;
  return removeUndefined({
    id,
    [`${kind}Id`]: id,
    name: rawName || id,
    category: normalizeOptionalText(source.category || source.type) || 'combat',
    tags: normalizeStringArray(source.tags),
    aliases: normalizeStringArray(source.aliases),
    description: normalizeOptionalText(source.description || source.summary || source.text),
    mechanicalEffect: normalizeOptionalText(source.mechanicalEffect || source.effect || source.rule || source.rulesText),
    sourceRef: normalizeOptionalText(source.sourceRef || source.bookRef),
    source: normalizeOptionalText(source.source),
    status: normalizeOptionalText(source.status),
    numericValues,
    metadata
  });
}

function normalizeCombatMechanicAction(source = {}, numericValues = {}) {
  const metadata = normalizeObject(source.metadata);
  const explicit = normalizeObject(metadata.combatAction || metadata.action || source.combatAction || source.action);
  const inline = {};
  for (const key of [
    'id',
    'actionId',
    'name',
    'mode',
    'actionMode',
    'actionKind',
    'kind',
    'type',
    'weight',
    'targetPolicy',
    'successThresholdPolicy',
    'successThreshold',
    'dc',
    'targetAc',
    'diceCount',
    'diceSides',
    'modifier',
    'attackModifier',
    'criticalMode',
    'criticalDamageMultiplier',
    'damage',
    'damageRolls',
    'damageDice',
    'applyDamageOnMiss',
    'acBonus',
    'defenseBonus',
    'dodgeBonus',
    'temporaryHp',
    'tempHp',
    'damageReduction',
    'durationRounds',
    'rounds',
    'statusEffects',
    'statuses',
    'resourceCosts',
    'costs'
  ]) {
    if (source[key] !== undefined) inline[key] = source[key];
  }
  const combatAction = {
    ...inline,
    ...explicit
  };
  if (!Object.keys(combatAction).length && Object.keys(numericValues).length) {
    if (numericValues.damageAmount !== undefined || numericValues.damage !== undefined) {
      combatAction.mode = 'attack';
    } else if (numericValues.acBonus !== undefined || numericValues.temporaryHp !== undefined) {
      combatAction.mode = 'defense';
    }
  }
  return normalizeObject(combatAction);
}

function normalizeSkillBar(value = {}, combatMechanics = {}) {
  const source = normalizeObject(value);
  const actions = mergeById([
    ...normalizeArray(source.actions).map((action) => normalizeMechanicActionRef(action, 'skill')),
    ...normalizeArray(combatMechanics.skills).map((skill) => mechanicRecordToActionRef(skill, 'skill'))
  ]);
  const skills = mergeById([
    ...normalizeArray(source.skills).map((skill) => normalizeMechanicActionRef(skill, 'skill')),
    ...normalizeArray(combatMechanics.skills).map((skill) => mechanicRecordToActionRef(skill, 'skill'))
  ]);
  const feats = mergeById([
    ...normalizeArray(source.feats).map((feat) => normalizeMechanicActionRef(feat, 'feat')),
    ...normalizeArray(combatMechanics.feats).map((feat) => mechanicRecordToActionRef(feat, 'feat'))
  ]);
  return {
    ...source,
    ...(actions.length ? { actions } : {}),
    ...(skills.length ? { skills } : {}),
    ...(feats.length ? { feats } : {})
  };
}

function normalizeCombatResources(value = {}, combatMechanics = {}) {
  const resources = normalizeObject(value);
  const combat = normalizeObject(resources.combat);
  return {
    ...resources,
    combat: {
      ...combat,
      skillIds: mergeStringArrays(combat.skillIds, mechanicIds(combat.skills, 'skill'), combatMechanics.skills.map((skill) => skill.id)),
      featIds: mergeStringArrays(combat.featIds, mechanicIds(combat.feats, 'feat'), combatMechanics.feats.map((feat) => feat.id)),
      statusIds: mergeStringArrays(combat.statusIds, mechanicIds(combat.statuses, 'status'), combatMechanics.statuses.map((status) => status.id))
    }
  };
}

function mechanicIds(value = [], kind = 'skill') {
  return normalizeArray(value)
    .map((item) => typeof item === 'string' ? item : item?.[`${kind}Id`] || item?.id)
    .filter(Boolean);
}

function normalizeMechanicActionRef(value = {}, kind = 'skill') {
  const source = normalizeObject(value);
  const id = safeSegment(source.id || source.actionId || source.mechanicId || source[`${kind}Id`] || source.name);
  return removeUndefined({
    ...source,
    id,
    name: normalizeOptionalText(source.name || source.label || id),
    mechanicKind: normalizeOptionalText(source.mechanicKind || kind),
    mechanicId: normalizeOptionalText(source.mechanicId || source[`${kind}Id`] || id),
    [`${kind}Id`]: normalizeOptionalText(source[`${kind}Id`] || source.mechanicId || id)
  });
}

function mechanicRecordToActionRef(record = {}, kind = 'skill') {
  return removeUndefined({
    id: record.id,
    name: record.name,
    mechanicKind: kind,
    mechanicId: record.id,
    [`${kind}Id`]: record.id
  });
}

function mergeById(items = []) {
  const seen = new Set();
  return normalizeArray(items).filter((item) => {
    if (!item?.id) return false;
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function mergeStringArrays(...values) {
  return normalizeStringArray(values.flatMap((value) => normalizeStringArray(value)));
}

function normalizeStatusList(value = []) {
  return normalizeArray(value)
    .filter((status) => status && typeof status === 'object' && !Array.isArray(status))
    .map((status) => ({
      id: safeSegment(status.id || status.name || status.status || createId('status')),
      name: normalizeOptionalText(status.name || status.status || status.id),
      active: status.active !== false,
      stacks: normalizeOptionalNumber(status.stacks),
      intensity: normalizeOptionalNumber(status.intensity ?? status.value),
      remainingTurns: normalizeOptionalNumber(status.remainingTurns ?? status.duration ?? status.turns),
      source: normalizeOptionalText(status.source),
      description: normalizeOptionalText(status.description || status.text),
      metadata: normalizeObject(status.metadata),
      _delete: status._delete === true
    }));
}

function normalizeInventory(value = {}) {
  const source = normalizeObject(value);
  return {
    currency: normalizeNumericValues(source.currency || {}),
    items: normalizeArray(source.items)
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => ({
        ...item,
        id: safeSegment(item.id || item.name || createId('item')),
        name: normalizeOptionalText(item.name || item.id),
        quantity: normalizeOptionalNumber(item.quantity ?? item.count, 1)
      }))
  };
}

function normalizeSpecialHook(value = {}) {
  const source = normalizeObject(value);
  if (!Object.keys(source).length && !normalizeOptionalText(value)) return undefined;
  if (!Object.keys(source).length) {
    return {
      id: createId('specialhook'),
      description: normalizeOptionalText(value)
    };
  }
  return {
    id: safeSegment(source.id || source.name || source.title || createId('specialhook')),
    trigger: normalizeOptionalText(source.trigger || source.when),
    description: normalizeOptionalText(source.description || source.text || source.summary),
    routing: normalizeOptionalText(source.routing || source.route) || 'judge_special_action',
    metadata: normalizeObject(source.metadata)
  };
}

function normalizeLooseObject(value) {
  return normalizeObject(value);
}

function normalizeNumericValues(value = {}) {
  const object = normalizeObject(value);
  const output = {};
  for (const [key, raw] of Object.entries(object)) {
    if (raw === undefined || raw === null || raw === '') continue;
    if (typeof raw === 'object') continue;
    const number = Number(raw);
    if (Number.isFinite(number)) output[safeField(key)] = number;
  }
  return output;
}

function normalizeMode(value) {
  const normalized = normalizeOptionalText(value).toLowerCase();
  if (['defend', 'guard', 'block'].includes(normalized)) return 'defense';
  if (['evade', 'avoid'].includes(normalized)) return 'dodge';
  return normalized;
}

function normalizeArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return [...new Set((Array.isArray(value) ? value : [value])
    .flatMap((item) => typeof item === 'string' ? item.split(',') : [item])
    .map((item) => String(item).trim())
    .filter(Boolean))];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function removeUndefined(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ''));
}

function normalizeOptionalNumber(value, fallback = undefined) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeRequiredText(value, field) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) throw validationError(`${field} is required`);
  return normalized;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function safeField(value) {
  const field = String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 128);
  return field || 'value';
}

function safeSegment(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/[^A-Za-z0-9_\-\u4e00-\u9fa5_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 160) || createId('id');
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'RpgCombatEngineValidationError';
  error.statusCode = 400;
  return error;
}
