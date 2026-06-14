// @ts-nocheck
import { CombatManager } from '../combat/combat-manager.js';

export const COMBAT_PLUGIN = {
  id: 'system.combat',
  name: 'Deterministic Combat Flow Tools',
  version: '0.1.0',
  description: 'Independent RPG combat module: no-LLM ordinary turns after numeric enemy objects; optional LLM only for battle start, enemy object generation, special combat calls, and aftermath planning.',
  enabled: true,
  permissions: ['combat:read', 'combat:write', 'combat:judge'],
  metadata: {
    normalCombatUsesLlm: false,
    optionalLlmEntryPoints: ['judge_start', 'build_enemy_object_prompt', 'judge_special_action', 'plan_aftermath']
  },
  tools: [
    tool('describe_combat', 'Describe Combat Module', 'Describe combat boundaries, deterministic flow, LLM entry points, and templates.', {
      type: 'object',
      properties: { chatSessionId: { type: 'string' } },
      additionalProperties: false
    }, false, ['combat', 'schema', 'templates']),
    tool('list_battles', 'List Combat Battles', 'List chat-local combat battle records.', listSchema(), false, ['combat', 'query']),
    tool('get_battle', 'Get Combat Battle', 'Get one battle record.', idSchema(), false, ['combat', 'query']),
    tool('list_events', 'List Combat Events', 'List events for one battle or all battles in a chat.', {
      type: 'object',
      properties: {
        chatSessionId: { type: 'string' },
        battleId: { type: 'string' },
        eventType: { type: 'string' },
        filter: { type: 'object', additionalProperties: true },
        sort: sortSchema(),
        limit: { type: 'integer', minimum: 1, maximum: 500 },
        offset: { type: 'integer', minimum: 0 }
      },
      required: ['chatSessionId'],
      additionalProperties: false
    }, false, ['combat', 'events', 'query']),
    tool('judge_start', 'Judge Battle Start', 'Optional LLM/human judgement for whether a scene should enter battle. Does not mutate state.', startSchema(true), false, ['combat', 'start', 'llm', 'judge']),
    tool('prepare_battle', 'Prepare Battle From Chat Action', 'Prepare or start a standalone RPG battle from a player chat combat declaration: resolve player actor, generate missing numeric enemies, spawn combatants with default attacks, and create the battle record.', prepareBattleSchema(), true, ['combat', 'start', 'bootstrap', 'enemy-object', 'no-llm']),
    tool('start_battle', 'Start Battle', 'Create a chat-local battle record. Can use judge_start when useLlm=true, but direct start needs no LLM.', startSchema(true), true, ['combat', 'start', 'write']),
    tool('describe_action_table_reference', 'Describe Hidden Action Table Reference', 'Describe the hidden numeric enemy action table reference. It only chooses attack, defense, or dodge and is intended for opening battle modelling/debug.', {
      type: 'object',
      properties: {},
      additionalProperties: false
    }, false, ['combat', 'action-table', 'reference', 'no-llm']),
    tool('build_action_table_prompt', 'Build Hidden Action Table Prompt', 'Build an editable prompt for creating a hidden enemy action table from the opponent setting. The table has no skill names and only attack/defense/dodge modes.', actionTablePromptSchema(), false, ['combat', 'action-table', 'prompt']),
    tool('normalize_action_table', 'Normalize Hidden Action Table', 'Normalize a supplied hidden action table into attack/defense/dodge weights and numeric payloads. Does not call LLM or mutate state.', actionTableSchema(), false, ['combat', 'action-table', 'normalize', 'no-llm']),
    tool('select_action_from_table', 'Select Hidden Action Mode', 'Select attack, defense, or dodge from a normalized hidden action table using weighted secure randomness or an injected roll for debugging.', selectActionTableSchema(), false, ['combat', 'action-table', 'selector', 'no-llm']),
    tool('build_enemy_object_prompt', 'Build Enemy Object Prompt', 'Build an editable prompt for creating one numeric enemy object with registry-backed combat mechanics before standalone RPG combat. The generated object is then run without LLM.', enemyObjectPromptSchema(), false, ['combat', 'enemy-object', 'prompt']),
    tool('normalize_enemy_object', 'Normalize Enemy Object', 'Normalize a supplied enemy object into NPC state, defenses, resources, skill/action refs, registry-backed combat mechanics, and fallback action policy. Does not call LLM.', enemyObjectSchema(), false, ['combat', 'enemy-object', 'normalize', 'mechanics', 'no-llm']),
    tool('spawn_combatant', 'Spawn Numeric Combatant', 'Write generated combat mechanics into the registry, write the normalized combatant into NPC structured state, and reset action economy. No LLM is used.', spawnCombatantSchema(), true, ['combat', 'enemy-object', 'spawn', 'npc-state', 'resources', 'mechanics', 'no-llm']),
    tool('select_enemy_action', 'Select Enemy Combat Action', 'Read an enemy actor state, mechanics registry refs, statuses, feats, and action bar to select one no-LLM combat action candidate.', enemyActionSelectionSchema(), false, ['combat', 'enemy-turn', 'selector', 'mechanics', 'no-llm']),
    tool('resolve_enemy_turn', 'Resolve Ordinary Enemy Turn', 'Resolve one ordinary enemy turn without LLM by selecting attack/defense/dodge and applying dice, resources, effects, or state patches.', enemyTurnSchema(), true, ['combat', 'enemy-turn', 'action-table', 'effects', 'resources', 'no-llm']),
    tool('list_player_actions', 'List Player Combat Actions', 'Read a player actor state and mechanics registry refs to list selectable no-LLM combat actions for UI/player choice.', playerActionListSchema(), false, ['combat', 'player-action', 'selector', 'mechanics', 'no-llm']),
    tool('build_player_action', 'Build Player Combat Action', 'Build a system.combat.resolve_action input from one selected player combat action. Does not execute the action.', playerActionBuildSchema(), false, ['combat', 'player-action', 'selector', 'no-llm']),
    tool('build_special_prompt', 'Build Special Combat Prompt', 'Collect context and build an editable prompt for non-option combat actions or special textual abilities.', specialSchema(false), false, ['combat', 'special', 'prompt']),
    tool('judge_special_action', 'Judge Special Combat Action', 'Optional LLM/human routing for special combat actions. Calling this judgement itself consumes no resources.', specialSchema(true), false, ['combat', 'special', 'llm', 'judge']),
    tool('resolve_action', 'Resolve Deterministic Combat Action', 'Resolve a normal combat action without LLM: validate/spend resources, roll/check dice, apply damage/healing/status settlement, and record a combat event.', combatActionSchema(), true, ['combat', 'action', 'no-llm', 'effects', 'resources']),
    tool('plan_aftermath', 'Plan Battle Aftermath', 'Optional LLM/human battle-end reward and influence planning. Does not mutate state.', aftermathSchema(true), false, ['combat', 'aftermath', 'reward', 'influence', 'llm']),
    tool('end_battle', 'End Battle', 'Mark a battle ended/won/lost/fled and optionally attach a LLM/human aftermath plan. Does not directly grant rewards or apply influence.', aftermathSchema(true), true, ['combat', 'end', 'aftermath', 'write']),
    tool('summarize_battle_result', 'Summarize Battle Result For AI', 'Create a compact no-LLM battle result payload for the GM/AI aftermath and later narrative consequences.', battleResultSummarySchema(), false, ['combat', 'battle-result', 'summary', 'no-llm'])
  ]
};

export function createCombatHandlers({ appDatabase, toolManager, manager, chatProvider, trace } = {}) {
  const combat = manager || new CombatManager({
    appDatabase,
    toolManager,
    chatProvider,
    trace
  });
  return {
    describe_combat: async ({ input }) => combat.describe(input.chatSessionId),
    list_battles: async ({ input }) => combat.listBattles(input),
    get_battle: async ({ input }) => combat.getBattle(input),
    list_events: async ({ input }) => combat.listEvents(input),
    judge_start: async ({ input }) => combat.judgeStart(input),
    prepare_battle: async ({ input }) => combat.prepareBattle(input),
    start_battle: async ({ input }) => combat.startBattle(input),
    describe_action_table_reference: async () => combat.describeActionTableReference(),
    build_action_table_prompt: async ({ input }) => combat.buildActionTablePrompt(input),
    normalize_action_table: async ({ input }) => combat.normalizeActionTable(input),
    select_action_from_table: async ({ input }) => combat.selectActionFromTable(input),
    build_enemy_object_prompt: async ({ input }) => combat.buildEnemyObjectPrompt(input),
    normalize_enemy_object: async ({ input }) => combat.normalizeEnemyObject(input),
    spawn_combatant: async ({ input }) => combat.spawnCombatant(input),
    select_enemy_action: async ({ input }) => combat.selectEnemyAction(input),
    resolve_enemy_turn: async ({ input }) => combat.resolveEnemyTurn(input),
    list_player_actions: async ({ input }) => combat.listPlayerActions(input),
    build_player_action: async ({ input }) => combat.buildPlayerAction(input),
    build_special_prompt: async ({ input }) => combat.buildSpecialPrompt(input),
    judge_special_action: async ({ input }) => combat.judgeSpecialAction(input),
    resolve_action: async ({ input }) => combat.resolveAction(input),
    plan_aftermath: async ({ input }) => combat.planAftermath(input),
    end_battle: async ({ input }) => combat.endBattle(input),
    summarize_battle_result: async ({ input }) => combat.summarizeBattleResult(input)
  };
}

function tool(name, title, description, inputSchema, mutatesState, tags, metadata = {}) {
  return {
    name,
    title,
    description,
    inputSchema,
    visibility: 'public',
    autoCallable: true,
    mutatesState,
    metadata: {
      scope: 'chat-session',
      writesTrace: true,
      ...metadata
    },
    tags
  };
}

function idSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      battleId: { type: 'string' },
      id: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function listSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string' },
      status: { type: 'string' },
      query: { type: 'string' },
      filter: { type: 'object', additionalProperties: true },
      sort: sortSchema(),
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function startSchema(includeLlm) {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      battleId: { type: 'string' },
      id: { type: 'string' },
      name: { type: 'string' },
      title: { type: 'string' },
      battleName: { type: 'string' },
      status: { type: 'string' },
      shouldStartBattle: { type: 'boolean' },
      participantIds: stringArraySchema(),
      allyIds: stringArraySchema(),
      enemyIds: stringArraySchema(),
      objective: { type: 'string' },
      stakes: { type: 'string' },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      userRules: { type: 'string' },
      startPrompt: { type: 'string' },
      battle: { type: 'object', additionalProperties: true },
      decision: { type: 'object', additionalProperties: true },
      startDecision: { type: 'object', additionalProperties: true },
      context: { type: 'object', additionalProperties: true },
      includeContext: { type: 'boolean', default: true },
      metadata: { type: 'object', additionalProperties: true },
      ...(includeLlm ? llmFields() : {})
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function prepareBattleSchema() {
  return {
    type: 'object',
    properties: {
      ...startSchema(true).properties,
      dryRun: { type: 'boolean', default: false },
      actorId: { type: 'string' },
      playerId: { type: 'string' },
      controlledActorId: { type: 'string' },
      protagonistActorId: { type: 'string' },
      actorName: { type: 'string' },
      playerName: { type: 'string' },
      enemyCount: { type: 'integer', minimum: 1, maximum: 50 },
      enemyName: { type: 'string' },
      enemyLabel: { type: 'string' },
      enemy: { type: 'object', additionalProperties: true },
      enemies: { type: 'array', items: { type: 'object', additionalProperties: true } },
      enemyObjects: { type: 'array', items: { type: 'object', additionalProperties: true } },
      spawnEnemies: { type: 'boolean', default: true },
      autoSpawnEnemies: { type: 'boolean', default: true },
      autoCreatePlayer: { type: 'boolean', default: true },
      continueActiveBattle: { type: 'boolean', default: true },
      forceNewBattle: { type: 'boolean', default: false },
      autoEndOnDefeat: { type: 'boolean', default: true },
      resetActorActionEconomy: { type: 'boolean', default: true },
      resetPlayerActionEconomy: { type: 'boolean', default: true },
      includeDefaultEnemyAttack: { type: 'boolean', default: true },
      loot: { type: 'array', items: {} },
      rewards: { type: 'array', items: {} }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function specialSchema(includeLlm) {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      battleId: { type: 'string' },
      actorId: { type: 'string' },
      npcId: { type: 'string' },
      playerId: { type: 'string' },
      targetId: { type: 'string' },
      targetIds: stringArraySchema(),
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      userRules: { type: 'string' },
      specialPrompt: { type: 'string' },
      battle: { type: 'object', additionalProperties: true },
      judgement: { type: 'object', additionalProperties: true },
      specialJudgement: { type: 'object', additionalProperties: true },
      context: { type: 'object', additionalProperties: true },
      includeContext: { type: 'boolean', default: true },
      recordEvent: { type: 'boolean', default: true },
      ...(includeLlm ? llmFields() : {})
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function combatActionSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      battleId: { type: 'string' },
      actionId: { type: 'string' },
      id: { type: 'string' },
      actorId: { type: 'string' },
      npcId: { type: 'string' },
      playerId: { type: 'string' },
      targetId: { type: 'string' },
      targetNpcId: { type: 'string' },
      targetIds: stringArraySchema(),
      targets: { type: 'array', items: {} },
      target: {},
      actionKind: { type: 'string' },
      kind: { type: 'string' },
      type: { type: 'string' },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      dryRun: { type: 'boolean', default: false },
      autoHit: { type: 'boolean', default: false },
      hit: {},
      hitResult: { type: 'object', additionalProperties: true },
      attackResult: { type: 'object', additionalProperties: true },
      attack: { type: 'object', additionalProperties: true },
      attackRoll: { type: 'object', additionalProperties: true },
      check: { type: 'object', additionalProperties: true },
      diceInput: { type: 'object', additionalProperties: true },
      successThreshold: { type: 'integer' },
      dc: { type: 'integer' },
      targetAc: { type: 'integer' },
      ac: { type: 'integer' },
      diceCount: { type: 'integer' },
      rollCount: { type: 'integer' },
      diceSides: { type: 'integer' },
      sides: { type: 'integer' },
      modifier: { type: 'integer' },
      fixedModifier: { type: 'integer' },
      abilityModifier: { type: 'integer' },
      proficiencyBonus: { type: 'integer' },
      rollMode: { type: 'string' },
      forceMode: { type: 'string' },
      inspirationPoints: { type: 'integer' },
      criticalMode: { type: 'string' },
      criticalDamageMultiplier: { type: 'number' },
      damage: damageSchema(),
      damages: damageSchema(),
      damageRolls: { type: 'array', items: { type: 'object', additionalProperties: true } },
      damageDice: { type: 'array', items: { type: 'object', additionalProperties: true } },
      healing: {},
      heals: {},
      temporaryHp: {},
      tempHp: {},
      statusEffects: { type: 'array', items: { type: 'object', additionalProperties: true } },
      statuses: { type: 'array', items: { type: 'object', additionalProperties: true } },
      conditions: { type: 'array', items: { type: 'object', additionalProperties: true } },
      defenses: { type: 'object', additionalProperties: true },
      resistances: stringArraySchema(),
      vulnerabilities: stringArraySchema(),
      immunities: stringArraySchema(),
      applyDamageOnMiss: { type: 'boolean' },
      consumeAction: { type: 'boolean', default: true },
      actionResource: { type: 'string' },
      costs: { type: 'array', items: { type: 'object', additionalProperties: true } },
      resourceCosts: { type: 'array', items: { type: 'object', additionalProperties: true } },
      ammoCost: { type: 'object', additionalProperties: true },
      ammoResourceId: { type: 'string' },
      ammoAmount: { type: 'number' },
      consumableCost: { type: 'object', additionalProperties: true },
      consumableId: { type: 'string' },
      consumableAmount: { type: 'number' },
      recordEvent: { type: 'boolean', default: true },
      useModifierResolver: { type: 'boolean', default: true },
      applyModifiers: { type: 'boolean', default: true },
      metadata: { type: 'object', additionalProperties: true }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function aftermathSchema(includeLlm) {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string' },
      battleId: { type: 'string' },
      id: { type: 'string' },
      outcome: { type: 'string' },
      status: { type: 'string' },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      summary: { type: 'string' },
      dryRun: { type: 'boolean', default: false },
      applyRewards: { type: 'boolean', default: true },
      applyImpactToolCalls: { type: 'boolean', default: true },
      applyInfluence: { type: 'boolean', default: true },
      continueOnImpactError: { type: 'boolean', default: false },
      allowUnresolvedVictory: { type: 'boolean', default: false },
      requireDefeatedEnemies: { type: 'boolean', default: false },
      enforceDefeatedEnemies: { type: 'boolean', default: false },
      rewardActorId: { type: 'string' },
      recipientActorId: { type: 'string' },
      actorId: { type: 'string' },
      playerId: { type: 'string' },
      rewards: { type: 'array', items: {} },
      loot: { type: 'array', items: {} },
      currency: { type: 'object', additionalProperties: { type: 'number' } },
      authorization: {},
      userAuthorization: {},
      approval: {},
      userRules: { type: 'string' },
      aftermathPrompt: { type: 'string' },
      aftermath: { type: 'object', additionalProperties: true },
      battle: { type: 'object', additionalProperties: true },
      context: { type: 'object', additionalProperties: true },
      includeContext: { type: 'boolean', default: true },
      metadata: { type: 'object', additionalProperties: true },
      ...(includeLlm ? llmFields() : {})
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function actionTablePromptSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      battleId: { type: 'string' },
      actorId: { type: 'string' },
      npcId: { type: 'string' },
      enemyId: { type: 'string' },
      enemy: { type: 'object', additionalProperties: true },
      npc: { type: 'object', additionalProperties: true },
      actor: { type: 'object', additionalProperties: true },
      settingText: { type: 'string' },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      userReference: { type: 'string' },
      numericReference: { type: 'string' },
      reference: { type: 'object', additionalProperties: true },
      context: { type: 'object', additionalProperties: true },
      includeContext: { type: 'boolean', default: true }
    },
    additionalProperties: false
  };
}

function actionTableSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      actorId: { type: 'string' },
      npcId: { type: 'string' },
      enemyId: { type: 'string' },
      table: { type: 'object', additionalProperties: true },
      actionTable: { type: 'object', additionalProperties: true },
      actionTableId: { type: 'string' },
      tableId: { type: 'string' },
      id: { type: 'string' },
      threatTier: { type: 'string' },
      tier: { type: 'string' },
      source: { type: 'string' },
      weights: weightSchema(),
      attackWeight: { type: 'number' },
      defenseWeight: { type: 'number' },
      dodgeWeight: { type: 'number' },
      attack: { type: 'object', additionalProperties: true },
      defense: { type: 'object', additionalProperties: true },
      dodge: { type: 'object', additionalProperties: true },
      actions: {
        type: 'array',
        items: { type: 'object', additionalProperties: true }
      },
      notes: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true }
    },
    additionalProperties: false
  };
}

function selectActionTableSchema() {
  return {
    type: 'object',
    properties: {
      ...actionTableSchema().properties,
      roll: { type: 'number', minimum: 0, maximum: 1 },
      selectionRoll: { type: 'number', minimum: 0, maximum: 1 }
    },
    additionalProperties: false
  };
}

function enemyObjectPromptSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      battleId: { type: 'string' },
      enemy: { type: 'object', additionalProperties: true },
      enemyObject: { type: 'object', additionalProperties: true },
      npc: { type: 'object', additionalProperties: true },
      actor: { type: 'object', additionalProperties: true },
      settingText: { type: 'string' },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      userReference: { type: 'string' },
      numericReference: { type: 'string' },
      reference: { type: 'object', additionalProperties: true },
      context: { type: 'object', additionalProperties: true },
      includeContext: { type: 'boolean', default: true }
    },
    additionalProperties: false
  };
}

function enemyObjectSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      enemy: { type: 'object', additionalProperties: true },
      enemyObject: { type: 'object', additionalProperties: true },
      combatant: { type: 'object', additionalProperties: true },
      actor: { type: 'object', additionalProperties: true },
      enemyId: { type: 'string' },
      npcId: { type: 'string' },
      actorId: { type: 'string' },
      id: { type: 'string' },
      name: { type: 'string' },
      actorType: { type: 'string' },
      type: { type: 'string' },
      threatTier: { type: 'string' },
      tier: { type: 'string' },
      values: { type: 'object', additionalProperties: true },
      numericValues: { type: 'object', additionalProperties: true },
      hp: { type: 'number' },
      currentHp: { type: 'number' },
      maxHp: { type: 'number' },
      armorClass: { type: 'number' },
      ac: { type: 'number' },
      speed: { type: 'number' },
      statusBar: { type: 'object', additionalProperties: true },
      skillBar: { type: 'object', additionalProperties: true },
      defenses: { type: 'object', additionalProperties: true },
      damageDefenses: { type: 'object', additionalProperties: true },
      resources: { type: 'object', additionalProperties: true },
      combatMechanics: { type: 'object', additionalProperties: true },
      mechanicsRegistry: { type: 'object', additionalProperties: true },
      generatedMechanics: { type: 'object', additionalProperties: true },
      mechanics: { type: 'object', additionalProperties: true },
      combatSkills: { type: 'array', items: { type: 'object', additionalProperties: true } },
      combatFeats: { type: 'array', items: { type: 'object', additionalProperties: true } },
      combatStatuses: { type: 'array', items: { type: 'object', additionalProperties: true } },
      specialStatuses: { type: 'array', items: { type: 'object', additionalProperties: true } },
      statuses: { type: 'array', items: { type: 'object', additionalProperties: true } },
      inventory: { type: 'object', additionalProperties: true },
      equipment: { type: 'object', additionalProperties: true },
      normalActionPolicy: { type: 'object', additionalProperties: true },
      actionPolicy: { type: 'object', additionalProperties: true },
      actionTable: { type: 'object', additionalProperties: true },
      table: { type: 'object', additionalProperties: true },
      specialHooks: { type: 'array', items: { type: 'object', additionalProperties: true } },
      specialAbilities: { type: 'array', items: { type: 'object', additionalProperties: true } },
      lootHints: { type: 'array', items: {} },
      loot: { type: 'array', items: {} },
      rewards: { type: 'array', items: {} },
      plotTags: stringArraySchema(),
      tags: stringArraySchema(),
      metadata: { type: 'object', additionalProperties: true }
    },
    additionalProperties: false
  };
}

function spawnCombatantSchema() {
  return {
    type: 'object',
    properties: {
      ...enemyObjectSchema().properties,
      battleId: { type: 'string' },
      dryRun: { type: 'boolean', default: false },
      recordEvent: { type: 'boolean', default: true },
      source: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function enemyTurnSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      battleId: { type: 'string' },
      actionId: { type: 'string' },
      id: { type: 'string' },
      actorId: { type: 'string' },
      enemyId: { type: 'string' },
      npcId: { type: 'string' },
      targetId: { type: 'string' },
      targetNpcId: { type: 'string' },
      targetIds: stringArraySchema(),
      targets: stringArraySchema(),
      normalActionPolicy: { type: 'object', additionalProperties: true },
      actionPolicy: { type: 'object', additionalProperties: true },
      actionTable: { type: 'object', additionalProperties: true },
      table: { type: 'object', additionalProperties: true },
      roll: { type: 'number', minimum: 0, maximum: 1 },
      selectionRoll: { type: 'number', minimum: 0, maximum: 1 },
      targetAc: { type: 'integer' },
      ac: { type: 'integer' },
      forceMode: { type: 'string' },
      rollMode: { type: 'string' },
      inspirationPoints: { type: 'integer' },
      criticalMode: { type: 'string' },
      consumeAction: { type: 'boolean', default: true },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      dryRun: { type: 'boolean', default: false },
      recordEvent: { type: 'boolean', default: true },
      metadata: { type: 'object', additionalProperties: true }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function enemyActionSelectionSchema() {
  return {
    type: 'object',
    properties: {
      ...enemyTurnSchema().properties,
      actorState: { type: 'object', additionalProperties: true },
      mechanicRefs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string' },
            id: { type: 'string' }
          },
          required: ['kind', 'id'],
          additionalProperties: true
        }
      },
      includeBasicAttack: { type: 'boolean', default: true }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function playerActionListSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      battleId: { type: 'string' },
      actorId: { type: 'string' },
      playerId: { type: 'string' },
      npcId: { type: 'string' },
      targetId: { type: 'string' },
      targetNpcId: { type: 'string' },
      targetIds: stringArraySchema(),
      targetAc: { type: 'integer' },
      actorState: { type: 'object', additionalProperties: true },
      mechanicRefs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string' },
            id: { type: 'string' }
          },
          required: ['kind', 'id'],
          additionalProperties: true
        }
      },
      selectedActionId: { type: 'string' },
      actionChoiceId: { type: 'string' },
      choiceId: { type: 'string' },
      includeBasicAttack: { type: 'boolean', default: true }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function playerActionBuildSchema() {
  return {
    type: 'object',
    properties: {
      ...playerActionListSchema().properties,
      actionId: { type: 'string' },
      id: { type: 'string' },
      outputActionId: { type: 'string' },
      resolveActionId: { type: 'string' },
      sourceText: { type: 'string' },
      hitResult: { type: 'object', additionalProperties: true }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function battleResultSummarySchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string' },
      battleId: { type: 'string' },
      id: { type: 'string' },
      outcome: { type: 'string' },
      battle: { type: 'object', additionalProperties: true },
      events: { type: 'array', items: { type: 'object', additionalProperties: true } },
      actors: { type: 'array', items: { type: 'object', additionalProperties: true } },
      states: { type: 'array', items: { type: 'object', additionalProperties: true } },
      actorIds: stringArraySchema(),
      eventLimit: { type: 'integer', minimum: 1, maximum: 500 },
      maxEvents: { type: 'integer', minimum: 1, maximum: 100 }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function weightSchema() {
  return {
    type: 'object',
    properties: {
      attack: { type: 'number' },
      defense: { type: 'number' },
      dodge: { type: 'number' }
    },
    additionalProperties: false
  };
}

function llmFields() {
  return {
    useLlm: { type: 'boolean', default: false },
    temperature: { type: 'number' },
    maxTokens: { type: 'integer', minimum: 1, maximum: 12000 }
  };
}

function damageSchema() {
  return {
    oneOf: [
      { type: 'number' },
      { type: 'object', additionalProperties: true },
      { type: 'array', items: { oneOf: [{ type: 'number' }, { type: 'object', additionalProperties: true }] } }
    ]
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

function sortSchema() {
  return {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        field: { type: 'string' },
        direction: { type: 'string', enum: ['asc', 'desc'] }
      },
      required: ['field'],
      additionalProperties: false
    }
  };
}
