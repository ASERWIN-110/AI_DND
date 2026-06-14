// @ts-nocheck
import { StructuredInterfaceTraceRecorder } from '../structured/structured-interface.js';
import { createId } from '../utils/id.js';
import { parseFirstJsonObject } from '../utils/json.js';
import {
  COMBAT_ACTION_TABLE_REFERENCE,
  COMBAT_ACTION_TABLE_TEMPLATE,
  buildCombatActionTablePrompt,
  normalizeCombatActionTable,
  selectCombatActionFromTable
} from './combat-action-table.js';
import {
  RPG_COMBAT_ENEMY_OBJECT_REFERENCE,
  RPG_COMBAT_ENEMY_OBJECT_TEMPLATE,
  buildEnemyObjectPrompt as buildRpgEnemyObjectPrompt,
  buildEnemyStatePatch,
  buildOrdinaryDefensePatch,
  normalizeEnemyObject,
  summarizeBattleForAi
} from './rpg-combat-engine.js';
import { selectEnemyCombatAction } from './enemy-action-selector.js';
import { buildPlayerCombatAction, listPlayerCombatActions } from './player-action-selector.js';

export const COMBAT_BATTLES_COLLECTION = 'combat_battles';
export const COMBAT_EVENTS_COLLECTION = 'combat_events';
export const COMBAT_TRACE_DIR = 'data/combat-traces';

export const COMBAT_BATTLE_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id.' },
  { name: 'battleId', type: 'text', description: 'Stable combat battle id inside one chat.' },
  { name: 'sceneId', type: 'text', description: 'Scene where this battle is happening.' },
  { name: 'name', type: 'text', description: 'Human-readable battle name.' },
  { name: 'status', type: 'text', description: 'pending, active, won, lost, fled, ended, archived.' },
  { name: 'participantIds', type: 'json', description: 'Actor ids involved in the battle.' },
  { name: 'enemyIds', type: 'json', description: 'Enemy actor ids.' },
  { name: 'allyIds', type: 'json', description: 'Ally actor ids.' },
  { name: 'objective', type: 'text', description: 'Battle objective or victory condition summary.' },
  { name: 'stakes', type: 'text', description: 'What battle victory/failure affects.' },
  { name: 'startDecision', type: 'json', description: 'Optional LLM/human battle-start judgement.' },
  { name: 'aftermath', type: 'json', description: 'Optional battle-end reward and influence plan.' },
  { name: 'metadata', type: 'json', description: 'Extra battle metadata.' },
  { name: 'createdAtIso', type: 'text', description: 'Creation timestamp.' },
  { name: 'startedAt', type: 'text', description: 'Battle start timestamp.' },
  { name: 'endedAt', type: 'text', description: 'Battle end timestamp.' },
  { name: 'combatUpdatedAt', type: 'text', description: 'Latest battle update timestamp.' }
];

export const COMBAT_EVENT_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id.' },
  { name: 'eventId', type: 'text', description: 'Stable combat event id.' },
  { name: 'battleId', type: 'text', description: 'Owning battle id.' },
  { name: 'sceneId', type: 'text', description: 'Scene id.' },
  { name: 'eventType', type: 'text', description: 'start, action, special_judgement, aftermath, end, status, note.' },
  { name: 'actorId', type: 'text', description: 'Primary acting actor id.' },
  { name: 'targetIds', type: 'json', description: 'Target actor ids.' },
  { name: 'sourceText', type: 'text', description: 'Raw player/action text.' },
  { name: 'summary', type: 'text', description: 'Short event summary.' },
  { name: 'result', type: 'json', description: 'Action result, dice, settlement, resource cost, judgement, or aftermath payload.' },
  { name: 'metadata', type: 'json', description: 'Extra event metadata.' },
  { name: 'createdAtIso', type: 'text', description: 'Event timestamp.' }
];

export const COMBAT_START_DECISION_TEMPLATE = {
  decisionId: 'combat_start_debug_template',
  status: 'judged | notNeeded | needsMoreContext',
  shouldStartBattle: true,
  battleName: 'Short battle name',
  reason: 'Why this situation starts or does not start combat.',
  participantIds: ['pc_arin', 'npc_guard'],
  allyIds: ['pc_arin'],
  enemyIds: ['npc_guard'],
  objective: 'What ends the battle.',
  stakes: 'What victory or defeat affects.',
  recommendedOpening: 'Brief setup narration or tactical note.',
  metadata: {}
};

export const COMBAT_SPECIAL_JUDGEMENT_TEMPLATE = {
  judgementId: 'combat_special_debug_template',
  status: 'judged | needsMoreContext | rejected',
  actionText: 'The non-standard combat action.',
  actionMode: 'normalCombatAction | persuasion | actionResolver | narrativeOnly | rejected',
  consumesResourcesAfterResolution: true,
  resourceCosts: [
    { kind: 'actionEconomy', resource: 'action', amount: 1 }
  ],
  combatAction: {
    actionKind: 'attack | healing | status | effect',
    actorId: 'pc_arin',
    targetIds: ['npc_guard'],
    attack: { successThreshold: 15, diceCount: 1, diceSides: 20, modifier: 5 },
    damage: [{ type: 'bludgeoning', amount: 4 }]
  },
  explanationNeeded: false,
  summary: 'How to route this special action.',
  rulingGuidance: 'How to narrate the ruling after deterministic tools run.',
  followUpHooks: [],
  metadata: {}
};

export const COMBAT_AFTERMATH_TEMPLATE = {
  aftermathId: 'combat_aftermath_debug_template',
  status: 'planned | needsMoreContext',
  battleId: 'battle_id',
  outcome: 'won | lost | fled | ended',
  rewardPlan: {
    rewards: [],
    withheldRewards: [],
    rationale: 'Rewards are proportional to risk, difficulty, process, and opponents.'
  },
  influencePlan: {
    npcUpdates: [],
    factionUpdates: [],
    mapUpdates: [],
    questOrEncounterHooks: []
  },
  narrativeSummary: 'Short battle aftermath summary.',
  metadata: {}
};

export class CombatManager {
  constructor({
    appDatabase,
    toolManager,
    chatProvider,
    collections = {},
    trace,
    traceRecorder,
    cwd = process.cwd(),
    now
  } = {}) {
    if (!appDatabase) throw validationError('CombatManager requires appDatabase');
    if (!toolManager) throw validationError('CombatManager requires toolManager');
    this.appDatabase = appDatabase;
    this.toolManager = toolManager;
    this.chatProvider = chatProvider;
    this.collections = {
      battles: collections.battles || COMBAT_BATTLES_COLLECTION,
      events: collections.events || COMBAT_EVENTS_COLLECTION
    };
    this.now = now || (() => new Date().toISOString());
    this.traceRecorder = traceRecorder || new StructuredInterfaceTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      directory: trace?.directory || COMBAT_TRACE_DIR,
      cwd,
      now: this.now
    });
  }

  ensureCollections(chatSessionId) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const database = this.appDatabase.ensureChatDataDatabase(normalizedChatSessionId);
    const manager = this.appDatabase.openChatDataManagerByChatId(normalizedChatSessionId);
    for (const [collection, fields, reason] of [
      [this.collections.battles, COMBAT_BATTLE_FIELDS, 'combat:battles'],
      [this.collections.events, COMBAT_EVENT_FIELDS, 'combat:events']
    ]) {
      manager.ensureCollection(collection);
      manager.alterFields(collection, { add: fields, reason });
    }
    return {
      database,
      collections: {
        [this.collections.battles]: manager.describeCollection(this.collections.battles),
        [this.collections.events]: manager.describeCollection(this.collections.events)
      }
    };
  }

  describe(chatSessionId) {
    return {
      ...(chatSessionId ? this.ensureCollections(chatSessionId) : {}),
      llmBoundaries: {
        noLlm: [
          'normal combat actions',
          'ordinary enemy turns after numeric enemy objects exist',
          'action economy and resource consumption',
          'attack/check dice',
          'damage/healing/status settlement',
          'cooldowns, ammo, consumables'
        ],
        llmOnlyWhenRequested: [
          'judge whether battle should begin',
          'generate or select a numeric enemy object before battle',
          'route special non-option combat actions',
          'explain special combat rulings',
          'plan battle-end rewards and world influence'
        ]
      },
      stateBoundary: 'Combat records store battle/event logs. Combatant HP/status/resources/enemy action policy remain in npc_structured_states via system.effects, system.resources, and spawned enemy objects.',
      templates: {
        startDecision: COMBAT_START_DECISION_TEMPLATE,
        specialJudgement: COMBAT_SPECIAL_JUDGEMENT_TEMPLATE,
        aftermath: COMBAT_AFTERMATH_TEMPLATE,
        actionTable: COMBAT_ACTION_TABLE_TEMPLATE,
        enemyObject: RPG_COMBAT_ENEMY_OBJECT_TEMPLATE
      }
    };
  }

  describeActionTableReference() {
    return {
      noLlm: true,
      hiddenPolicy: true,
      allowedModes: ['attack', 'defense', 'dodge'],
      reference: COMBAT_ACTION_TABLE_REFERENCE,
      template: COMBAT_ACTION_TABLE_TEMPLATE
    };
  }

  listBattles(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(chatSessionId);
    const filter = { ...normalizeObject(input.filter) };
    if (input.sceneId) filter.sceneId = normalizeOptionalText(input.sceneId);
    if (input.status) filter.status = normalizeOptionalText(input.status);
    const result = manager.queryRecords(this.collections.battles, {
      filter,
      sort: input.sort || [{ field: 'combatUpdatedAt', direction: 'desc' }],
      limit: input.limit || 100,
      offset: input.offset || 0
    });
    const query = normalizeSearchText(input.query);
    return {
      ...result,
      records: result.records.filter((record) => {
        if (!query) return true;
        return normalizeSearchText(JSON.stringify(record.data || {})).includes(query);
      })
    };
  }

  getBattle(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const battleId = normalizeRequiredText(input.battleId || input.id, 'battleId');
    const { manager } = this.openManager(chatSessionId);
    return manager.getRecord(this.collections.battles, battleRecordId(battleId));
  }

  listEvents(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(chatSessionId);
    const filter = { ...normalizeObject(input.filter) };
    if (input.battleId) filter.battleId = normalizeOptionalText(input.battleId);
    if (input.eventType) filter.eventType = normalizeOptionalText(input.eventType);
    return manager.queryRecords(this.collections.events, {
      filter,
      sort: input.sort || [{ field: 'createdAtIso', direction: 'asc' }],
      limit: input.limit || 200,
      offset: input.offset || 0
    });
  }

  async judgeStart(input = {}) {
    return this.withTrace('combat-judge-start', input.chatSessionId, input, async () => {
      const context = input.context || await this.collectContext(input);
      const prompt = buildCombatStartPrompt({ ...input, context });
      const rawDecision = input.decision || input.startDecision || await this.createStartDecision(input, prompt);
      const decision = normalizeStartDecision(rawDecision, input);
      return {
        decision,
        rawDecision,
        prompt,
        context
      };
    });
  }

  async startBattle(input = {}) {
    return this.withTrace('combat-start-battle', input.chatSessionId, input, async () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const sceneId = normalizeOptionalText(input.sceneId) || 'current';
      const decisionResult = input.useLlm || input.decision || input.startDecision
        ? await this.judgeStart(input)
        : undefined;
      const decision = decisionResult?.decision || normalizeStartDecision({
        ...input.battle,
        shouldStartBattle: input.shouldStartBattle ?? true,
        battleName: input.name || input.title || input.battleName,
        participantIds: input.participantIds,
        allyIds: input.allyIds,
        enemyIds: input.enemyIds,
        objective: input.objective,
        stakes: input.stakes
      }, input);
      if (!decision.shouldStartBattle) {
        return {
          ok: false,
          skipped: true,
          reason: decision.reason || 'battle_not_started',
          decision,
          context: decisionResult?.context,
          prompt: decisionResult?.prompt
        };
      }
      const { manager } = this.openManager(chatSessionId);
      const battle = normalizeBattleRecord({
        ...input.battle,
        chatSessionId,
        sceneId,
        battleId: input.battleId || input.id || input.battle?.battleId,
        name: input.name || input.title || decision.battleName,
        status: input.status || 'active',
        participantIds: input.participantIds || decision.participantIds,
        allyIds: input.allyIds || decision.allyIds,
        enemyIds: input.enemyIds || decision.enemyIds,
        objective: input.objective || decision.objective,
        stakes: input.stakes || decision.stakes,
        startDecision: decision,
        metadata: input.metadata
      }, { now: this.now });
      const record = manager.upsertRecord(this.collections.battles, battle, { id: battleRecordId(battle.battleId) });
      const event = this.addEvent({
        chatSessionId,
        battleId: battle.battleId,
        sceneId,
        eventType: 'start',
        sourceText: input.sourceText || input.text || input.content || '',
        summary: decision.reason || `Battle started: ${battle.name}`,
        result: { decision },
        metadata: { llmUsed: Boolean(input.useLlm) }
      });
      return {
        ok: true,
        battle: record,
        event,
        decision,
        context: decisionResult?.context,
        prompt: decisionResult?.prompt
      };
    });
  }

  async prepareBattle(input = {}) {
    return this.withTrace('combat-prepare-battle', input.chatSessionId, input, async () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const sceneId = normalizeOptionalText(input.sceneId) || 'current';
      const sourceText = normalizeOptionalText(input.sourceText || input.text || input.content);
      const actorId = normalizeOptionalText(
        input.actorId
        || input.playerId
        || input.controlledActorId
        || input.protagonistActorId
      ) || 'pc_player';
      const actorName = normalizeOptionalText(input.actorName || input.playerName) || actorId;
      const activeContinuation = input.continueActiveBattle === false || input.forceNewBattle === true
        ? undefined
        : await this.continueActiveBattleFromChat({
            ...input,
            chatSessionId,
            sceneId,
            sourceText,
            actorId,
            actorName
          });
      if (activeContinuation) return activeContinuation;
      const enemyInputs = normalizePreparedEnemyInputs(input, { sourceText, sceneId });
      const enemyObjects = enemyInputs.map((enemy, index) => withDefaultEnemyAttack(enemy, {
        index,
        sceneId,
        sourceText,
        includeDefaultAttack: input.includeDefaultEnemyAttack !== false
      }));
      const enemyIds = enemyObjects.map((enemy) => normalizeEnemyObject(enemy, { sceneId }).enemyId);
      const participantIds = compactUnique([
        ...normalizeStringArray(input.participantIds),
        actorId,
        ...enemyIds
      ]);
      const allyIds = compactUnique([
        ...normalizeStringArray(input.allyIds),
        actorId
      ]);
      const battleInput = {
        chatSessionId,
        sceneId,
        battleId: input.battleId || input.id || createId('battle'),
        name: input.name || input.title || input.battleName || inferBattleName(sourceText, enemyObjects),
        status: input.status || 'active',
        participantIds,
        allyIds,
        enemyIds,
        objective: input.objective || `Defeat or drive off ${enemyObjects.length > 1 ? 'the enemies' : (enemyObjects[0]?.name || 'the enemy')}.`,
        stakes: input.stakes || 'Victory controls the immediate scene outcome.',
        sourceText,
        metadata: {
          ...normalizeObject(input.metadata),
          preparedFromChat: true,
          autoGeneratedEnemyCount: enemyObjects.length,
          enemyLootHints: enemyObjects.flatMap((enemy) => normalizeArray(enemy.lootHints || enemy.loot || enemy.rewards))
        }
      };
      const plannedToolCalls = [
        {
          tool: 'system.npc_state.patch_state',
          input: buildDefaultPlayerStatePatch({
            chatSessionId,
            sceneId,
            actorId,
            actorName,
            source: 'combat-prepare-battle'
          })
        },
        {
          tool: 'system.resources.reset_action_economy',
          input: {
            chatSessionId,
            sceneId,
            npcId: actorId,
            movementMax: 30,
            source: 'combat-prepare-battle'
          }
        },
        ...enemyObjects.map((enemy) => ({
          tool: 'system.combat.spawn_combatant',
          input: {
            chatSessionId,
            sceneId,
            battleId: battleInput.battleId,
            enemy,
            dryRun: input.dryRun === true,
            source: 'combat-prepare-battle'
          }
        })),
        {
          tool: 'system.combat.start_battle',
          input: battleInput
        }
      ];

      if (input.dryRun) {
        return {
          ok: true,
          status: 'dry_run',
          dryRun: true,
          actorId,
          enemyIds,
          enemies: enemyObjects.map((enemy) => normalizeEnemyObject(enemy, { sceneId })),
          battleInput,
          plannedToolCalls,
          llmUsed: false
        };
      }

      let playerState;
      if (input.autoCreatePlayer !== false) {
        const existingPlayer = await this.getActorState({ chatSessionId, sceneId, actorId });
        if (!existingPlayer) {
          playerState = await this.toolManager.executeTool('system.npc_state.patch_state', plannedToolCalls[0].input);
          await safeExecuteTool(this.toolManager, 'system.resources.reset_action_economy', plannedToolCalls[1].input);
        }
      }

      const spawned = [];
      if (input.spawnEnemies !== false && input.autoSpawnEnemies !== false) {
        for (const enemy of enemyObjects) {
          const result = await this.spawnCombatant({
            chatSessionId,
            sceneId,
            battleId: battleInput.battleId,
            enemy,
            source: 'combat-prepare-battle'
          });
          spawned.push(result);
        }
      }

      const battle = await this.startBattle({
        ...battleInput,
        enemyIds: spawned.length ? spawned.map((entry) => entry.enemy.enemyId) : enemyIds,
        participantIds: spawned.length ? compactUnique([actorId, ...spawned.map((entry) => entry.enemy.enemyId)]) : participantIds,
        allyIds
      });
      return {
        ok: true,
        status: 'prepared',
        dryRun: false,
        actorId,
        enemyIds: battle.battle.data.enemyIds,
        enemies: spawned.map((entry) => entry.enemy),
        playerState: playerState?.output,
        spawned,
        battle: battle.battle,
        event: battle.event,
        decision: battle.decision,
        llmUsed: false
      };
    });
  }

  async continueActiveBattleFromChat(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const sceneId = normalizeOptionalText(input.sceneId) || 'current';
    const sourceText = normalizeOptionalText(input.sourceText || input.text || input.content);
    const activeBattle = this.findActiveBattle({ chatSessionId, sceneId });
    if (!activeBattle) return undefined;

    const battle = activeBattle.data;
    const actorId = normalizeOptionalText(input.actorId || input.playerId || input.controlledActorId || input.protagonistActorId)
      || normalizeStringArray(battle.allyIds)[0]
      || normalizeStringArray(battle.participantIds)[0]
      || 'pc_player';
    const enemiesBefore = await this.collectBattleEnemyStates({ chatSessionId, sceneId, battle });
    const livingBefore = enemiesBefore.filter((entry) => isActorAlive(entry.data || entry));
    const wantsLoot = /搜刮|拾取|捡|剥取|采集|收集|掉落|战利品|素材|loot|drop|reward/i.test(sourceText);
    if (wantsLoot && livingBefore.length === 0) {
      const ended = await this.endBattle({
        chatSessionId,
        sceneId,
        battleId: battle.battleId,
        outcome: 'won',
        rewardActorId: actorId,
        sourceText,
        useLlm: input.useLlm,
        authorization: input.authorization,
        metadata: {
          continuedFromActiveBattle: true,
          reason: 'loot_after_all_enemies_defeated'
        }
      });
      return {
        ok: true,
        status: 'ended',
        mode: 'active_battle_loot',
        battle: ended.battle,
        event: ended.event,
        aftermath: ended.aftermath,
        rewardApplication: ended.rewardApplication,
        impactApplication: ended.impactApplication,
        activeBattle: battle,
        enemiesBefore,
        llmUsed: Boolean(input.useLlm)
      };
    }
    if (livingBefore.length === 0) {
      return {
        ok: false,
        status: 'blocked',
        reason: 'active_battle_has_no_living_enemies',
        activeBattle: battle,
        enemiesBefore,
        playerMessage: '当前战斗没有可攻击的存活敌人；请结束战斗或搜刮战利品。',
        llmUsed: false
      };
    }

    const target = selectBattleTargetFromText(sourceText, livingBefore) || livingBefore[0];
    const targetId = target?.data?.npcId || target?.data?.actorId || target?.id;
    if (!targetId) {
      return {
        ok: false,
        status: 'blocked',
        reason: 'missing_active_battle_target',
        activeBattle: battle,
        enemiesBefore,
        playerMessage: '当前战斗有敌人，但未能确定本次攻击目标。',
        llmUsed: false
      };
    }

    if (input.resetActorActionEconomy !== false && input.resetPlayerActionEconomy !== false) {
      const actorState = await this.getActorState({ chatSessionId, sceneId, actorId });
      await safeExecuteTool(this.toolManager, 'system.resources.reset_action_economy', {
        chatSessionId,
        sceneId,
        npcId: actorId,
        movementMax: firstFiniteNumber(actorState?.data?.values?.speed, actorState?.data?.statusBar?.speed, 30),
        source: 'combat-active-battle-chat-turn'
      });
    }

    let playerAction;
    try {
      playerAction = await this.buildPlayerAction({
        chatSessionId,
        sceneId,
        battleId: battle.battleId,
        actorId,
        targetId,
        sourceText,
        includeBasicAttack: true
      });
    } catch (error) {
      playerAction = {
        resolveActionInput: {
          chatSessionId,
          sceneId,
          battleId: battle.battleId,
          actorId,
          targetId,
          actionKind: 'attack',
          sourceText,
          attack: { diceCount: 1, diceSides: 20, modifier: 0, criticalMode: 'd20' },
          damage: [{ type: 'damage', amount: 1 }],
          consumeAction: true,
          metadata: {
            fallbackReason: serializeError(error)
          }
        }
      };
    }

    const actionResult = await this.resolveAction({
      ...playerAction.resolveActionInput,
      sourceText
    });
    const enemiesAfter = await this.collectBattleEnemyStates({ chatSessionId, sceneId, battle });
    const livingAfter = enemiesAfter.filter((entry) => isActorAlive(entry.data || entry));
    const shouldAutoEnd = input.autoEndOnDefeat !== false && livingAfter.length === 0;
    const ended = shouldAutoEnd
      ? await this.endBattle({
          chatSessionId,
          sceneId,
          battleId: battle.battleId,
          outcome: 'won',
          rewardActorId: actorId,
          sourceText,
          useLlm: input.useLlm,
          authorization: input.authorization,
          metadata: {
            continuedFromActiveBattle: true,
            reason: 'all_enemies_defeated'
          }
        })
      : undefined;

    return {
      ok: true,
      status: ended ? 'ended' : actionResult.status,
      mode: 'active_battle_action',
      activeBattle: battle,
      actorId,
      targetId,
      targetName: target?.data?.name,
      enemiesBefore,
      playerAction,
      actionResult,
      enemiesAfter,
      endBattle: ended,
      battle: ended?.battle || activeBattle,
      rewardApplication: ended?.rewardApplication,
      llmUsed: Boolean(input.useLlm)
    };
  }

  findActiveBattle({ chatSessionId, sceneId = 'current' } = {}) {
    const { manager } = this.openManager(chatSessionId);
    const records = manager.queryRecords(this.collections.battles, {
      filter: { status: 'active' },
      sort: [{ field: 'combatUpdatedAt', direction: 'desc' }],
      limit: 20
    }).records;
    return records.find((record) => !sceneId || record.data.sceneId === sceneId)
      || records[0];
  }

  async buildSpecialPrompt(input = {}) {
    return this.withTrace('combat-build-special-prompt', input.chatSessionId, input, async () => {
      const context = input.context || await this.collectContext(input);
      const prompt = buildCombatSpecialPrompt({ ...input, context });
      return {
        prompt,
        context,
        judgementShape: COMBAT_SPECIAL_JUDGEMENT_TEMPLATE
      };
    });
  }

  async buildActionTablePrompt(input = {}) {
    return this.withTrace('combat-build-action-table-prompt', input.chatSessionId, input, async () => {
      const context = input.context || await this.collectContext(input);
      const prompt = buildCombatActionTablePrompt({
        enemy: input.enemy || input.npc || input.actor,
        actor: input.actor,
        settingText: input.settingText || input.sourceText || input.text || input.content,
        context,
        userReference: input.userReference || input.numericReference,
        reference: input.reference || COMBAT_ACTION_TABLE_REFERENCE
      });
      return {
        prompt,
        context,
        reference: COMBAT_ACTION_TABLE_REFERENCE,
        template: COMBAT_ACTION_TABLE_TEMPLATE
      };
    });
  }

  async normalizeActionTable(input = {}) {
    return this.withTrace('combat-normalize-action-table', input.chatSessionId, input, async () => ({
      actionTable: normalizeCombatActionTable(input.table || input.actionTable || input, {
        actorId: input.actorId || input.npcId || input.enemyId
      }),
      reference: COMBAT_ACTION_TABLE_REFERENCE
    }));
  }

  async selectActionFromTable(input = {}) {
    return this.withTrace('combat-select-action-from-table', input.chatSessionId, input, async () => selectCombatActionFromTable(input, {
      roll: input.roll ?? input.selectionRoll
    }));
  }

  async buildEnemyObjectPrompt(input = {}) {
    return this.withTrace('combat-build-enemy-object-prompt', input.chatSessionId, input, async () => {
      const context = input.context || await this.collectContext(input);
      const prompt = buildRpgEnemyObjectPrompt({
        enemy: input.enemy || input.enemyObject || input.npc || input.actor,
        actor: input.actor,
        settingText: input.settingText || input.sourceText || input.text || input.content,
        context,
        userReference: input.userReference,
        numericReference: input.numericReference,
        reference: input.reference || RPG_COMBAT_ENEMY_OBJECT_REFERENCE
      });
      return {
        prompt,
        context,
        reference: RPG_COMBAT_ENEMY_OBJECT_REFERENCE,
        template: RPG_COMBAT_ENEMY_OBJECT_TEMPLATE
      };
    });
  }

  async normalizeEnemyObject(input = {}) {
    return this.withTrace('combat-normalize-enemy-object', input.chatSessionId, input, async () => ({
      enemy: normalizeEnemyObject(input.enemy || input.enemyObject || input.combatant || input, {
        sceneId: input.sceneId
      }),
      reference: RPG_COMBAT_ENEMY_OBJECT_REFERENCE,
      template: RPG_COMBAT_ENEMY_OBJECT_TEMPLATE,
      llmUsed: false
    }));
  }

  async spawnCombatant(input = {}) {
    return this.withTrace('combat-spawn-combatant', input.chatSessionId, input, async () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const sceneId = normalizeOptionalText(input.sceneId) || 'current';
      const enemy = normalizeEnemyObject(input.enemy || input.enemyObject || input.combatant || input, { sceneId });
      const statePatch = buildEnemyStatePatch(enemy, {
        chatSessionId,
        sceneId,
        source: input.source || 'combat-spawn-combatant'
      });
      const plannedToolCalls = [
        ...buildMechanicUpsertCalls(enemy),
        { tool: 'system.npc_state.patch_state', input: statePatch },
        {
          tool: 'system.resources.reset_action_economy',
          input: {
            chatSessionId,
            sceneId,
            npcId: enemy.enemyId,
            movementMax: enemy.values.speed,
            source: 'combat-spawn-combatant'
          }
        }
      ];
      if (input.dryRun) {
        return {
          ok: true,
          dryRun: true,
          enemy,
          statePatch,
          plannedToolCalls,
          llmUsed: false
        };
      }
      const mechanicWrites = await this.registerEnemyCombatMechanics(enemy);
      const state = await this.toolManager.executeTool('system.npc_state.patch_state', removeUndefined(statePatch));
      const actionEconomy = await safeExecuteTool(this.toolManager, 'system.resources.reset_action_economy', {
        chatSessionId,
        sceneId,
        npcId: enemy.enemyId,
        movementMax: enemy.values.speed,
        source: 'combat-spawn-combatant'
      });
      const event = input.recordEvent === false ? undefined : this.addEvent({
        chatSessionId,
        battleId: input.battleId,
        sceneId,
        eventType: 'combatant_spawn',
        actorId: enemy.enemyId,
        summary: `Combatant spawned: ${enemy.name}`,
        result: { enemy, stateRecordId: state.output?.record?.id, actionEconomy, mechanicWrites },
        metadata: { llmUsed: false }
      });
      return {
        ok: true,
        dryRun: false,
        enemy,
        mechanicWrites,
        state: state.output,
        actionEconomy,
        event,
        llmUsed: false
      };
    });
  }

  async registerEnemyCombatMechanics(enemy = {}) {
    const writes = [];
    for (const call of buildMechanicUpsertCalls(enemy)) {
      const result = await this.toolManager.executeTool(call.tool, removeUndefined(call.input), undefined, {
        authorization: true,
        actor: 'system',
        reason: 'combat-spawn-combatant-generated-mechanics',
        audit: { skipAudit: true }
      });
      writes.push({
        tool: call.tool,
        id: call.input.id,
        name: call.input.name,
        output: result.output
      });
    }
    return writes;
  }

  async resolveEnemyTurn(input = {}) {
    return this.withTrace('combat-resolve-enemy-turn', input.chatSessionId, input, async () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const sceneId = normalizeOptionalText(input.sceneId) || 'current';
      const actorId = normalizeRequiredText(input.actorId || input.enemyId || input.npcId, 'actorId');
      const ordinaryAction = await selectEnemyCombatAction({
        toolManager: this.toolManager,
        input: {
          ...input,
          chatSessionId,
          sceneId,
          actorId
        },
        getActorState: (request) => this.getActorState(request)
      });
      const selected = ordinaryAction.selected;
      if (selected.mode === 'attack') {
        const targetId = resolveEnemyTurnTargetId(input, selected.payload);
        if (!targetId) throw validationError('targetId is required when ordinary enemy action selects attack');
        const targetState = await this.getActorState({ chatSessionId, sceneId, actorId: targetId });
        const actionInput = buildEnemyAttackActionInput({
          input,
          actorId,
          targetId,
          targetState: targetState?.data,
          payload: selected.payload
        });
        const actionResult = await this.resolveAction(actionInput);
        return {
          ok: actionResult.ok,
          status: actionResult.status,
          dryRun: Boolean(input.dryRun),
          actorId,
          targetId,
          ordinaryAction,
          actionInput,
          actionResult,
          llmUsed: false
        };
      }

      const action = {
        actionId: safeSegment(input.actionId || input.id || createId('combatordinary')),
        battleId: normalizeOptionalText(input.battleId),
        chatSessionId,
        sceneId,
        actorId,
        targetIds: [actorId],
        actionKind: selected.mode,
        sourceText: normalizeOptionalText(input.sourceText || input.text || input.content || `ordinary enemy ${selected.mode}`),
        metadata: normalizeObject(input.metadata)
      };
      const costPlan = normalizeCostPlan({
        consumeAction: input.consumeAction,
        resourceCosts: selected.payload.resourceCosts
      }, action);
      const costValidation = await this.validateCosts(action, costPlan);
      if (!costValidation.ok) {
        const blocked = {
          ok: false,
          status: 'blocked',
          reason: 'insufficient_resources',
          actorId,
          ordinaryAction,
          costPlan,
          costValidation,
          llmUsed: false
        };
        this.addEventFromAction(action, 'action', `Ordinary enemy ${selected.mode} blocked by insufficient resources.`, blocked);
        return blocked;
      }
      const statePatch = buildOrdinaryDefensePatch({
        chatSessionId,
        sceneId,
        actorId,
        mode: selected.mode,
        payload: selected.payload,
        source: 'combat-ordinary-turn'
      });
      const settlementInput = buildOrdinaryDefenseSettlementInput({
        chatSessionId,
        sceneId,
        actorId,
        payload: selected.payload,
        statePatch
      });
      const settlement = await this.resolveSettlement(settlementInput, Boolean(input.dryRun));
      let statePatchResult;
      let costApplications = [];
      if (!input.dryRun) {
        statePatchResult = await this.toolManager.executeTool('system.npc_state.patch_state', {
          chatSessionId,
          sceneId,
          npcId: actorId,
          statusBar: statePatch.statusBar,
          source: 'combat-ordinary-turn'
        });
        costApplications = await this.applyCosts(action, costPlan);
      }
      const result = {
        ok: true,
        status: input.dryRun ? 'dry_run' : 'resolved',
        dryRun: Boolean(input.dryRun),
        actorId,
        ordinaryAction,
        statePatch,
        settlement,
        statePatchResult: statePatchResult?.output,
        costPlan,
        costValidation,
        costApplications,
        llmUsed: false
      };
      const event = input.recordEvent === false ? undefined : this.addEventFromAction(action, 'action', `Ordinary enemy ${selected.mode}: ${actorId}`, result);
      return {
        ...result,
        event
      };
    });
  }

  async selectEnemyAction(input = {}) {
    return this.withTrace('combat-select-enemy-action', input.chatSessionId, input, async () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const sceneId = normalizeOptionalText(input.sceneId) || 'current';
      const actorId = normalizeRequiredText(input.actorId || input.enemyId || input.npcId, 'actorId');
      return selectEnemyCombatAction({
        toolManager: this.toolManager,
        input: {
          ...input,
          chatSessionId,
          sceneId,
          actorId
        },
        getActorState: (request) => this.getActorState(request)
      });
    });
  }

  async listPlayerActions(input = {}) {
    return this.withTrace('combat-list-player-actions', input.chatSessionId, input, async () => listPlayerCombatActions({
      toolManager: this.toolManager,
      input
    }));
  }

  async buildPlayerAction(input = {}) {
    return this.withTrace('combat-build-player-action', input.chatSessionId, input, async () => buildPlayerCombatAction({
      toolManager: this.toolManager,
      input
    }));
  }

  async judgeSpecialAction(input = {}) {
    return this.withTrace('combat-judge-special-action', input.chatSessionId, input, async () => {
      const context = input.context || await this.collectContext(input);
      const prompt = buildCombatSpecialPrompt({ ...input, context });
      const rawJudgement = input.judgement || input.specialJudgement || await this.createSpecialJudgement(input, prompt);
      const judgement = normalizeSpecialJudgement(rawJudgement, input);
      const event = input.recordEvent === false ? undefined : this.addEvent({
        chatSessionId: input.chatSessionId,
        battleId: input.battleId,
        sceneId: input.sceneId || context.sceneId,
        eventType: 'special_judgement',
        actorId: judgement.combatAction?.actorId || input.actorId || input.npcId || input.playerId,
        targetIds: judgement.combatAction?.targetIds || normalizeStringArray(input.targetIds || input.targetId),
        sourceText: input.sourceText || input.text || input.content || judgement.actionText,
        summary: judgement.summary,
        result: { judgement },
        metadata: { llmUsed: Boolean(input.useLlm) }
      });
      return {
        judgement,
        rawJudgement,
        prompt,
        context,
        event
      };
    });
  }

  async resolveAction(input = {}) {
    return this.withTrace('combat-resolve-action', input.chatSessionId, input, async () => {
      const action = normalizeCombatAction(input);
      const battle = action.battleId ? safeGetBattle(this, action) : undefined;
      const costPlan = normalizeCostPlan(input, action);
      const costValidation = await this.validateCosts(action, costPlan);
      if (!costValidation.ok) {
        const blocked = {
          ok: false,
          status: 'blocked',
          reason: 'insufficient_resources',
          action,
          costPlan,
          costValidation,
          battle
        };
        this.addEventFromAction(action, 'action', 'Action blocked by insufficient resources.', blocked);
        return blocked;
      }
      const attack = await this.resolveAttack(action, input);
      const damage = await this.resolveDamage(action, input, attack);
      const settlementInput = await this.resolveSettlementModifiers(buildSettlementInput(action, input, attack, damage), action, input, damage);
      const settlement = await this.resolveSettlement(settlementInput, Boolean(input.dryRun));
      const actorState = await this.getActorState({
        chatSessionId: action.chatSessionId,
        sceneId: action.sceneId,
        actorId: action.actorId
      });
      const targetStates = (await Promise.all(action.targetIds.map((actorId) => this.getActorState({
        chatSessionId: action.chatSessionId,
        sceneId: action.sceneId,
        actorId
      })))).filter(Boolean);
      let costApplications = [];
      if (!input.dryRun) {
        costApplications = await this.applyCosts(action, costPlan);
      }
      const result = {
        ok: true,
        status: input.dryRun ? 'dry_run' : 'resolved',
        dryRun: Boolean(input.dryRun),
        battle,
        action,
        costPlan,
        costValidation,
        attack,
        damage,
        settlement,
        actorState,
        targetStates,
        costApplications,
        llmUsed: false
      };
      const event = input.recordEvent === false ? undefined : this.addEventFromAction(action, 'action', buildActionSummary(result), result);
      return {
        ...result,
        event
      };
    });
  }

  async planAftermath(input = {}) {
    return this.withTrace('combat-plan-aftermath', input.chatSessionId, input, async () => {
      const battle = input.battle || (input.battleId ? this.getBattle(input).data : undefined);
      const context = input.context || await this.collectContext(input);
      const prompt = buildCombatAftermathPrompt({ ...input, battle, context });
      const rawAftermath = input.aftermath || await this.createAftermath(input, prompt);
      const aftermath = normalizeAftermath(rawAftermath, {
        battleId: input.battleId || battle?.battleId,
        outcome: input.outcome || input.status
      });
      return {
        aftermath,
        rawAftermath,
        prompt,
        context,
        battle
      };
    });
  }

  async endBattle(input = {}) {
    return this.withTrace('combat-end-battle', input.chatSessionId, input, async () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const current = this.getBattle(input);
      const battle = current.data;
      const outcome = normalizeOptionalText(input.outcome || input.status) || 'ended';
      const normalizedOutcome = normalizeCombatStatus(outcome);
      if (['won', 'victory', 'success'].includes(normalizedOutcome) && input.allowUnresolvedVictory !== true) {
        const enemyStates = await this.collectBattleEnemyStates({
          chatSessionId,
          sceneId: battle.sceneId,
          battle
        });
        if (!normalizeStringArray(battle.enemyIds).length || enemyStates.length === 0) {
          return {
            ok: false,
            status: 'blocked',
            reason: 'victory_requires_tracked_enemies',
            battle: current,
            enemyIds: normalizeStringArray(battle.enemyIds),
            enemyStates,
            playerMessage: '战斗胜利不能在没有可追踪敌人的情况下结算；请先生成或修复战斗敌人。'
          };
        }
        const livingEnemies = enemyStates.filter((entry) => isActorAlive(entry.data || entry));
        if ((input.requireDefeatedEnemies === true || input.enforceDefeatedEnemies === true) && livingEnemies.length > 0) {
          return {
            ok: false,
            status: 'blocked',
            reason: 'victory_requires_defeated_enemies',
            battle: current,
            enemyIds: normalizeStringArray(battle.enemyIds),
            livingEnemies,
            playerMessage: '仍有敌人未被击败，不能直接按胜利退出战斗。'
          };
        }
      }
      const aftermathResult = input.useLlm || input.aftermath
        ? await this.planAftermath({ ...input, battle, outcome })
        : undefined;
      const aftermath = aftermathResult?.aftermath || normalizeAftermath({
        outcome,
        narrativeSummary: input.summary || `Battle ${outcome}.`
      }, { battleId: battle.battleId, outcome });
      const { manager } = this.openManager(chatSessionId);
      const patch = {
        ...battle,
        status: normalizeCombatStatus(outcome),
        aftermath,
        endedAt: this.now(),
        combatUpdatedAt: this.now()
      };
      const record = manager.upsertRecord(this.collections.battles, patch, { id: current.id });
      const event = this.addEvent({
        chatSessionId,
        battleId: battle.battleId,
        sceneId: battle.sceneId,
        eventType: 'end',
        sourceText: input.sourceText || input.text || input.content || '',
        summary: aftermath.narrativeSummary || `Battle ended: ${outcome}`,
        result: { outcome, aftermath },
        metadata: { llmUsed: Boolean(input.useLlm) }
      });
      const rewardApplication = await this.applyBattleRewards({
        chatSessionId,
        sceneId: battle.sceneId,
        battle: patch,
        outcome,
        aftermath,
        input
      });
      const impactApplication = await this.applyExplicitAftermathToolCalls({
        chatSessionId,
        sceneId: battle.sceneId,
        battle: patch,
        outcome,
        aftermath,
        input,
        rewardApplication
      });
      return {
        battle: record,
        event,
        aftermath,
        rewardApplication,
        impactApplication,
        prompt: aftermathResult?.prompt,
        context: aftermathResult?.context
      };
    });
  }

  async applyBattleRewards({ chatSessionId, sceneId, battle = {}, outcome = '', aftermath = {}, input = {} } = {}) {
    if (input.applyRewards === false) {
      return { status: 'skipped', reason: 'disabled' };
    }
    const normalizedOutcome = normalizeCombatStatus(outcome || battle.status || aftermath.outcome);
    if (!['won', 'victory', 'success'].includes(normalizedOutcome)) {
      return { status: 'skipped', reason: 'outcome_not_victory', outcome: normalizedOutcome };
    }
    const rewards = normalizeBattleRewardItems([
      ...normalizeArray(input.rewards),
      ...normalizeArray(input.loot),
      ...normalizeArray(aftermath.rewardPlan?.rewards),
      ...normalizeArray(aftermath.rewardPlan?.loot),
      ...normalizeArray(aftermath.rewards),
      ...normalizeArray(aftermath.loot),
      ...(await this.collectDefaultBattleLoot({ chatSessionId, sceneId, battle }))
    ]);
    const currency = normalizeBattleRewardCurrency([
      input.currency,
      aftermath.rewardPlan?.currency,
      aftermath.currency
    ]);
    if (!rewards.length && !Object.keys(currency).length) {
      return { status: 'skipped', reason: 'no_numeric_rewards' };
    }
    const recipientActorId = normalizeOptionalText(
      input.rewardActorId
      || input.recipientActorId
      || input.actorId
      || input.playerId
      || normalizeStringArray(battle.allyIds)[0]
      || normalizeStringArray(battle.participantIds)[0]
    );
    if (!recipientActorId) {
      return { status: 'skipped', reason: 'missing_reward_recipient' };
    }
    const actorState = await this.getActorState({ chatSessionId, sceneId, actorId: recipientActorId });
    const inventory = mergeRewardInventory(actorState?.data?.inventory, {
      currency,
      items: rewards
    });
    const toolInput = removeUndefined({
      chatSessionId,
      sceneId,
      npcId: recipientActorId,
      inventory,
      source: 'combat-end-battle-reward'
    });
    if (input.dryRun) {
      return {
        status: 'dry_run',
        tool: 'system.npc_state.patch_state',
        input: toolInput,
        rewards,
        currency
      };
    }
    const result = await this.toolManager.executeTool('system.npc_state.patch_state', toolInput);
    return {
      status: 'applied',
      recipientActorId,
      tool: 'system.npc_state.patch_state',
      input: toolInput,
      output: result.output,
      rewards,
      currency
    };
  }

  async applyExplicitAftermathToolCalls({ chatSessionId, sceneId, battle = {}, outcome = '', aftermath = {}, input = {}, rewardApplication } = {}) {
    const calls = normalizeAftermathToolCalls(aftermath, {
      chatSessionId,
      sceneId,
      battle,
      outcome,
      rewardApplication
    });
    if (!calls.length) {
      return { status: 'skipped', reason: 'no_explicit_tool_calls', plannedToolCalls: [] };
    }
    if (input.applyImpactToolCalls === false || input.applyInfluence === false) {
      return { status: 'planned', reason: 'impact_application_disabled', plannedToolCalls: calls };
    }
    if (input.dryRun) {
      return { status: 'dry_run', plannedToolCalls: calls };
    }
    const appliedToolCalls = [];
    const failedToolCalls = [];
    for (const call of calls) {
      try {
        const result = await this.toolManager.executeTool(call.tool, removeUndefined(call.input), undefined, {
          authorization: input.authorization || input.userAuthorization || input.approval,
          actor: input.authorizationActor || input.actor || 'combat-manager',
          reason: 'combat-aftermath-explicit-tool-call',
          audit: { skipAudit: true }
        });
        appliedToolCalls.push({
          ...call,
          output: result.output,
          trace: result.trace
        });
      } catch (error) {
        failedToolCalls.push({
          ...call,
          error: serializeError(error)
        });
        if (!input.continueOnImpactError) break;
      }
    }
    return {
      status: failedToolCalls.length ? (appliedToolCalls.length ? 'partial_failure' : 'failure') : 'applied',
      plannedToolCalls: calls,
      appliedToolCalls,
      failedToolCalls
    };
  }

  async summarizeBattleResult(input = {}) {
    return this.withTrace('combat-summarize-battle-result', input.chatSessionId, input, async () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const battle = input.battle || (input.battleId || input.id ? this.getBattle(input) : undefined);
      const battleData = battle?.data || battle || {};
      const events = input.events || (battleData.battleId
        ? this.listEvents({ chatSessionId, battleId: battleData.battleId, limit: input.eventLimit || 200 }).records
        : []);
      const states = input.actors || input.states || await this.collectBattleActorStates({
        chatSessionId,
        sceneId: input.sceneId || battleData.sceneId,
        actorIds: input.actorIds || battleData.participantIds
      });
      return {
        ...summarizeBattleForAi({
          battle,
          events,
          actors: states,
          outcome: input.outcome || battleData.status,
          maxEvents: input.maxEvents
        }),
        llmUsed: false
      };
    });
  }

  async resolveAttack(action, input) {
    const supplied = input.hit || input.hitResult || input.attackResult;
    if (supplied !== undefined) return normalizeHitResult(supplied);
    if (input.autoHit === true || ['healing', 'status', 'effect', 'defense', 'dodge'].includes(action.actionKind)) {
      return normalizeHitResult({ outcome: 'hit', hit: true, source: 'auto' });
    }
    const rawAttackInput = input.attack || input.attackRoll || input.check || input.diceInput || input;
    const attackInput = await this.resolveCheckModifiers(
      normalizeAttackInput(rawAttackInput, action),
      action,
      input,
      rawAttackInput
    );
    const { modifierResolution, ...diceInput } = attackInput;
    const result = await this.toolManager.executeTool('game.dice.check', diceInput);
    return {
      ...normalizeHitResult(result.output),
      input: diceInput,
      modifierResolution,
      output: result.output,
      trace: result.trace
    };
  }

  async resolveDamage(action, input, attack) {
    const supplied = normalizeDamageItems(input.damage ?? input.damages);
    const rolls = normalizeDamageRolls(input.damageRolls || input.damageDice);
    const rolled = [];
    for (const roll of rolls) {
      const diceInput = {
        successThreshold: -100000,
        diceCount: roll.diceCount,
        diceSides: roll.diceSides,
        modifier: roll.modifier || 0,
        criticalMode: roll.criticalMode || 'none'
      };
      const result = await this.toolManager.executeTool('game.dice.check', diceInput);
      rolled.push({
        type: roll.type || 'damage',
        amount: result.output.total,
        roll: {
          expression: result.output.dice?.expression,
          total: result.output.total,
          dice: result.output.dice?.expression,
          rolls: result.output.rolls
        }
      });
    }
    const multiplier = attack?.criticalSuccess && input.criticalDamageMultiplier
      ? normalizeNumber(input.criticalDamageMultiplier, 'criticalDamageMultiplier')
      : 1;
    return [...supplied, ...rolled].map((item) => ({
      ...item,
      amount: Math.max(0, normalizeNumber(item.amount ?? item.total ?? item.value ?? 0, 'damage.amount') * multiplier),
      roll: item.roll
    }));
  }

  async resolveSettlement(settlementInput, dryRun) {
    if (!settlementInput.targets.length && !settlementInput.damage.length && !settlementInput.healing.length && !settlementInput.statusEffects.length) {
      return { skipped: true, reason: 'no_effects' };
    }
    const tool = dryRun ? 'system.effects.preview_settlement' : 'system.effects.apply_settlement';
    const result = await this.toolManager.executeTool(tool, settlementInput);
    return result.output;
  }

  async resolveCheckModifiers(attackInput, action, input, rawAttackInput = {}) {
    if (input.useModifierResolver === false || input.applyModifiers === false) return attackInput;
    if (!this.toolManager?.getTool || !this.toolManager?.executeTool) return attackInput;
    try {
      this.toolManager.getTool('system.modifiers.resolve_check_modifiers');
    } catch {
      return attackInput;
    }
    const targetId = action.targetIds[0] || input.targetId || input.targetNpcId;
    const result = await safeExecuteTool(this.toolManager, 'system.modifiers.resolve_check_modifiers', {
      chatSessionId: action.chatSessionId,
      sceneId: action.sceneId,
      actorId: action.actorId,
      targetId,
      checkKind: 'attack',
      actionKind: action.actionKind,
      actionId: action.actionId,
      ability: input.ability,
      skillId: input.skillId || input.skill,
      damageTypes: collectDamageTypes(input.damage || input.damages || input.damageRolls || input.damageDice),
      base: attackInput,
      successThresholdLocked: hasExplicitSuccessThreshold(rawAttackInput) || hasExplicitSuccessThreshold(input)
    });
    if (!result.ok || !result.output?.resolved) return attackInput;
    const { modifierBreakdown, ...resolvedDiceInput } = result.output.resolved;
    return removeUndefined({
      ...attackInput,
      ...resolvedDiceInput,
      modifierResolution: {
        ...result.output,
        resolved: result.output.resolved,
        modifierBreakdown
      }
    });
  }

  async resolveSettlementModifiers(settlementInput, action, input, damage = []) {
    if (input.useModifierResolver === false || input.applyModifiers === false) return settlementInput;
    if (!this.toolManager?.getTool || !this.toolManager?.executeTool) return settlementInput;
    try {
      this.toolManager.getTool('system.modifiers.resolve_damage_defenses');
    } catch {
      return settlementInput;
    }
    const targets = [];
    const modifierResolutions = [];
    for (const target of settlementInput.targets || []) {
      const targetId = target.npcId || target.actorId || target.id;
      if (!targetId) {
        targets.push(target);
        continue;
      }
      const result = await safeExecuteTool(this.toolManager, 'system.modifiers.resolve_damage_defenses', {
        chatSessionId: action.chatSessionId,
        sceneId: action.sceneId,
        targetId,
        damageTypes: collectDamageTypes(damage)
      });
      if (!result.ok || !result.output?.defenses) {
        targets.push(target);
        continue;
      }
      modifierResolutions.push(result.output);
      targets.push({
        ...target,
        defenses: mergeDefenses(target.defenses, result.output.defenses)
      });
    }
    return {
      ...settlementInput,
      targets,
      rules: {
        ...normalizeObject(settlementInput.rules),
        modifierResolutions
      }
    };
  }

  async validateCosts(action, costPlan) {
    if (!costPlan.costs.length) return { ok: true, costs: [] };
    const result = await safeExecuteTool(this.toolManager, 'system.resources.get_actor_resources', {
      chatSessionId: action.chatSessionId,
      sceneId: action.sceneId,
      npcId: action.actorId
    });
    if (!result.ok) {
      return { ok: false, costs: [], error: result.error };
    }
    const snapshot = result.output.snapshot || {};
    const costs = costPlan.costs.map((cost) => validateOneCost(snapshot, cost));
    return {
      ok: costs.every((cost) => cost.ok),
      actorId: action.actorId,
      costs,
      snapshot
    };
  }

  async applyCosts(action, costPlan) {
    const applications = [];
    for (const cost of costPlan.costs) {
      const tool = cost.kind === 'actionEconomy'
        ? 'system.resources.spend_action_economy'
        : cost.kind === 'consumeItem'
          ? 'system.resources.consume_item'
          : 'system.resources.spend_resource';
      const input = buildCostToolInput(action, cost, tool);
      applications.push({
        cost,
        result: await this.toolManager.executeTool(tool, removeUndefined(input))
      });
    }
    return applications;
  }

  async collectContext(input = {}) {
    const chatSessionId = normalizeOptionalText(input.chatSessionId);
    const sceneId = normalizeOptionalText(input.sceneId) || 'current';
    const battleId = normalizeOptionalText(input.battleId || input.id);
    const context = {
      chatSessionId,
      sceneId,
      battleId,
      sourceText: normalizeOptionalText(input.sourceText || input.text || input.content),
      collectedAt: this.now(),
      sources: {},
      errors: []
    };
    if (!chatSessionId || input.includeContext === false) return context;
    if (battleId) {
      try {
        context.sources.battle = this.getBattle({ chatSessionId, battleId }).data;
      } catch (error) {
        context.errors.push({ key: 'battle', error: serializeError(error) });
      }
      context.sources.events = this.listEvents({ chatSessionId, battleId, limit: 50 }).records.map((record) => record.data);
    }
    for (const [key, tool, toolInput] of [
      ['sceneNpcs', 'system.scene_npcs.list_mounted_npcs', { chatSessionId, sceneId, includeInactive: false, limit: 50 }],
      ['npcStates', 'system.npc_state.list_states', { chatSessionId, sceneId, limit: 100 }],
      ['turnOrder', 'system.time.list_turn_order', { chatSessionId, includeInactive: false, limit: 100 }]
    ]) {
      const result = await safeExecuteTool(this.toolManager, tool, toolInput);
      if (result.ok) context.sources[key] = result.output;
      else context.errors.push({ key, tool, error: result.error });
    }
    return context;
  }

  async getActorState({ chatSessionId, sceneId = 'current', actorId }) {
    const result = await safeExecuteTool(this.toolManager, 'system.npc_state.get_state', {
      chatSessionId,
      sceneId,
      npcId: actorId
    });
    return result.ok ? result.output : undefined;
  }

  async collectBattleActorStates({ chatSessionId, sceneId = 'current', actorIds = [] } = {}) {
    const ids = normalizeStringArray(actorIds);
    if (!ids.length) {
      const listed = await safeExecuteTool(this.toolManager, 'system.npc_state.list_states', {
        chatSessionId,
        sceneId,
        limit: 500
      });
      return listed.ok ? listed.output.records || [] : [];
    }
    const records = [];
    for (const actorId of ids) {
      const record = await this.getActorState({ chatSessionId, sceneId, actorId });
      if (record) records.push(record);
    }
    return records;
  }

  async collectBattleEnemyStates({ chatSessionId, sceneId = 'current', battle = {} } = {}) {
    const battleData = battle?.data || battle || {};
    const enemyIds = normalizeStringArray(battleData.enemyIds);
    const found = [];
    const seen = new Set();
    for (const actorId of enemyIds) {
      const record = await this.getActorState({ chatSessionId, sceneId, actorId });
      if (!record) continue;
      const id = record.data?.npcId || record.data?.actorId || record.id || actorId;
      seen.add(id);
      found.push(record);
    }
    const listed = await safeExecuteTool(this.toolManager, 'system.npc_state.list_states', {
      chatSessionId,
      sceneId,
      limit: 500
    });
    if (listed.ok) {
      for (const record of listed.output.records || []) {
        const data = record.data || {};
        const id = data.npcId || data.actorId || record.id;
        if (seen.has(id)) continue;
        if (enemyIds.includes(id) || enemyIds.includes(record.id) || looksLikeBattleEnemy(data, battleData)) {
          seen.add(id);
          found.push(record);
        }
      }
    }
    return found;
  }

  async collectDefaultBattleLoot({ chatSessionId, sceneId = 'current', battle = {} } = {}) {
    const battleData = battle?.data || battle || {};
    const metadataLoot = normalizeArray(battleData.metadata?.enemyLootHints);
    const enemyStates = await this.collectBattleEnemyStates({ chatSessionId, sceneId, battle: battleData });
    const enemyLoot = enemyStates.flatMap((record) => {
      const data = record.data || record || {};
      return [
        ...normalizeArray(data.resources?.combat?.lootHints),
        ...normalizeArray(data.lootHints),
        ...normalizeArray(data.inventory?.lootHints)
      ];
    });
    return enemyLoot.length ? enemyLoot : metadataLoot;
  }

  addEvent(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(chatSessionId);
    const event = normalizeCombatEvent(input, { now: this.now });
    return manager.upsertRecord(this.collections.events, event, { id: eventRecordId(event.eventId) });
  }

  addEventFromAction(action, eventType, summary, result) {
    return this.addEvent({
      chatSessionId: action.chatSessionId,
      battleId: action.battleId,
      sceneId: action.sceneId,
      eventType,
      actorId: action.actorId,
      targetIds: action.targetIds,
      sourceText: action.sourceText,
      summary,
      result
    });
  }

  openManager(chatSessionId) {
    this.ensureCollections(chatSessionId);
    return {
      manager: this.appDatabase.openChatDataManagerByChatId(chatSessionId)
    };
  }

  snapshot(chatSessionId) {
    if (!chatSessionId) return {};
    const { manager } = this.openManager(chatSessionId);
    return {
      battles: manager.queryRecords(this.collections.battles, { limit: 200 }).records,
      events: manager.queryRecords(this.collections.events, { limit: 300 }).records
    };
  }

  async withTrace(operation, chatSessionId, input, fn) {
    const normalizedChatSessionId = normalizeOptionalText(chatSessionId);
    const before = normalizedChatSessionId ? this.snapshot(normalizedChatSessionId) : {};
    const trace = this.traceRecorder.start(operation, {
      sessionId: normalizedChatSessionId || 'no-session',
      input,
      stateBefore: before
    });
    try {
      const output = await fn();
      const after = normalizedChatSessionId ? this.snapshot(normalizedChatSessionId) : {};
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

  async createStartDecision(input, prompt) {
    if (input.useLlm) {
      const completion = await generateJson({
        chatProvider: this.chatProvider,
        prompt,
        system: 'You judge whether an RPG scene should enter combat. Return JSON only.',
        temperature: input.temperature ?? 0.2,
        maxTokens: input.maxTokens || 1200,
        missingMessage: 'Combat start judgement requested LLM, but no chatProvider is available'
      });
      return completion.json;
    }
    return {
      ...COMBAT_START_DECISION_TEMPLATE,
      decisionId: createId('combatstart'),
      status: 'notNeeded',
      shouldStartBattle: true,
      battleName: input.name || input.battleName || 'Battle',
      participantIds: normalizeStringArray(input.participantIds),
      allyIds: normalizeStringArray(input.allyIds),
      enemyIds: normalizeStringArray(input.enemyIds),
      objective: input.objective || '',
      stakes: input.stakes || '',
      reason: 'No LLM judgement requested; caller chose to start battle.'
    };
  }

  async createSpecialJudgement(input, prompt) {
    if (input.useLlm) {
      const completion = await generateJson({
        chatProvider: this.chatProvider,
        prompt,
        system: 'You route a non-standard RPG combat action. Return JSON only.',
        temperature: input.temperature ?? 0.3,
        maxTokens: input.maxTokens || 1600,
        missingMessage: 'Combat special action judgement requested LLM, but no chatProvider is available'
      });
      return completion.json;
    }
    return {
      ...COMBAT_SPECIAL_JUDGEMENT_TEMPLATE,
      judgementId: createId('combatspecial'),
      status: 'needsMoreContext',
      actionText: input.sourceText || input.text || input.content || '',
      actionMode: 'narrativeOnly',
      resourceCosts: [],
      combatAction: undefined,
      summary: 'Special combat action needs a supplied judgement or useLlm=true before deterministic combat tools can resolve it.',
      metadata: { source: 'template' }
    };
  }

  async createAftermath(input, prompt) {
    if (input.useLlm) {
      const completion = await generateJson({
        chatProvider: this.chatProvider,
        prompt,
        system: 'You plan RPG battle aftermath, fair rewards, and world influence. Return JSON only.',
        temperature: input.temperature ?? 0.4,
        maxTokens: input.maxTokens || 1800,
        missingMessage: 'Combat aftermath planning requested LLM, but no chatProvider is available'
      });
      return completion.json;
    }
    return {
      ...COMBAT_AFTERMATH_TEMPLATE,
      aftermathId: createId('combataftermath'),
      status: 'planned',
      outcome: input.outcome || 'ended',
      narrativeSummary: input.summary || 'Battle ended.',
      metadata: { source: 'template' }
    };
  }
}

function buildCostToolInput(action, cost, tool) {
  const base = {
    chatSessionId: action.chatSessionId,
    sceneId: action.sceneId,
    npcId: action.actorId,
    source: 'combat-manager'
  };
  if (tool === 'system.resources.spend_action_economy') {
    return {
      ...base,
      resource: cost.resource || 'action',
      amount: cost.amount,
      allowOverspend: cost.allowOverspend
    };
  }
  if (tool === 'system.resources.consume_item') {
    return {
      ...base,
      category: cost.category || 'consumables',
      resourceId: cost.resourceId || cost.itemId,
      itemId: cost.itemId || cost.resourceId,
      itemName: cost.itemName,
      amount: cost.amount,
      syncInventory: cost.syncInventory,
      removeWhenZero: cost.removeWhenZero,
      allowOverspend: cost.allowOverspend
    };
  }
  return {
    ...base,
    category: cost.category,
    resourceId: cost.resourceId,
    itemId: cost.itemId,
    itemName: cost.itemName,
    amount: cost.amount,
    syncInventory: cost.syncInventory,
    removeWhenZero: cost.removeWhenZero,
    allowOverspend: cost.allowOverspend
  };
}

function buildMechanicUpsertCalls(enemy = {}) {
  const mechanics = normalizeObject(enemy.combatMechanics);
  const calls = [];
  for (const [kind, plural] of [
    ['skill', 'skills'],
    ['feat', 'feats'],
    ['status', 'statuses']
  ]) {
    for (const record of normalizeArray(mechanics[plural])) {
      if (!record?.id) continue;
      calls.push({
        tool: `system.mechanics_registry.upsert_${kind}`,
        input: record
      });
    }
  }
  return calls;
}

function normalizePreparedEnemyInputs(input = {}, { sourceText = '', sceneId = 'current' } = {}) {
  const explicit = [
    ...normalizeArray(input.enemies),
    ...normalizeArray(input.enemyObjects),
    ...normalizeArray(input.enemy)
  ].filter((enemy) => enemy && typeof enemy === 'object' && !Array.isArray(enemy));
  if (explicit.length) {
    return explicit.map((enemy, index) => ({
      ...enemy,
      sceneId: enemy.sceneId || sceneId,
      lootHints: normalizeArray(enemy.lootHints || enemy.loot || enemy.rewards).length
        ? normalizeArray(enemy.lootHints || enemy.loot || enemy.rewards)
        : normalizeArray(input.loot || input.rewards),
      metadata: {
        ...normalizeObject(enemy.metadata),
        preparedEnemyIndex: index,
        sourceText
      }
    }));
  }
  const count = inferEnemyCount(input, sourceText);
  const label = inferEnemyLabel(input, sourceText);
  const tier = inferEnemyTier(input, sourceText);
  return Array.from({ length: count }, (_, index) => buildPreparedEnemyObject({
    index,
    count,
    label,
    tier,
    sceneId,
    sourceText,
    loot: normalizeArray(input.loot || input.rewards)
  }));
}

function withDefaultEnemyAttack(enemy = {}, { index = 0, sceneId = 'current', sourceText = '', includeDefaultAttack = true } = {}) {
  const source = normalizeObject(enemy);
  const hasMechanics = [
    ...normalizeArray(source.combatMechanics?.skills),
    ...normalizeArray(source.combatSkills),
    ...normalizeArray(source.skillBar?.actions),
    ...normalizeArray(source.resources?.combat?.actions),
    ...normalizeArray(source.normalActionPolicy?.actions)
  ].some((entry) => entry && typeof entry === 'object');
  if (!includeDefaultAttack || hasMechanics) {
    return {
      ...source,
      sceneId: source.sceneId || sceneId,
      metadata: {
        ...normalizeObject(source.metadata),
        sourceText
      }
    };
  }
  const enemyId = safeActorId(source.enemyId || source.npcId || source.actorId || source.id || `${source.name || 'enemy'}_${index + 1}_${createId('enemy')}`, 'enemy');
  const tier = inferEnemyTier(source, `${sourceText} ${source.threatTier || source.tier || ''}`);
  const stats = defaultEnemyStatsForTier(tier);
  const skillId = safeSegment(`skill_${enemyId}_basic_attack`);
  const defenseId = safeSegment(`feat_${enemyId}_guard`);
  const dodgeId = safeSegment(`status_${enemyId}_dodge`);
  const values = {
    ...stats.values,
    ...normalizeObject(source.values || source.numericValues)
  };
  const attackModifier = firstFiniteNumber(values.attackModifier, source.attackModifier, stats.attackModifier);
  return {
    ...source,
    enemyId,
    npcId: enemyId,
    actorId: enemyId,
    sceneId: source.sceneId || sceneId,
    name: normalizeOptionalText(source.name || source.title) || inferEnemyName(source, index),
    actorType: normalizeOptionalText(source.actorType || source.type) || 'monster',
    threatTier: normalizeOptionalText(source.threatTier || source.tier) || tier,
    values: {
      ...values,
      attackModifier
    },
    combatMechanics: {
      ...normalizeObject(source.combatMechanics),
      skills: [
        ...normalizeArray(source.combatMechanics?.skills),
        {
          id: skillId,
          name: 'Basic Attack',
          category: 'combat',
          numericValues: { weight: stats.weights.attack },
          metadata: {
            combatAction: {
              mode: 'attack',
              weight: stats.weights.attack,
              modifier: attackModifier,
              damage: [{ type: stats.damageType, amount: stats.damageAmount }],
              criticalMode: 'd20'
            }
          }
        }
      ],
      feats: [
        ...normalizeArray(source.combatMechanics?.feats),
        {
          id: defenseId,
          name: 'Guard',
          category: 'combat',
          numericValues: { weight: stats.weights.defense },
          metadata: {
            combatAction: {
              mode: 'defense',
              weight: stats.weights.defense,
              acBonus: stats.defenseAcBonus,
              temporaryHp: stats.defenseTemporaryHp,
              durationRounds: 1
            }
          }
        }
      ],
      statuses: [
        ...normalizeArray(source.combatMechanics?.statuses),
        {
          id: dodgeId,
          name: 'Dodge',
          category: 'combat',
          numericValues: { weight: stats.weights.dodge },
          metadata: {
            combatAction: {
              mode: 'dodge',
              weight: stats.weights.dodge,
              acBonus: stats.dodgeAcBonus,
              durationRounds: 1
            }
          }
        }
      ]
    },
    skillBar: {
      ...normalizeObject(source.skillBar),
      actions: [
        ...normalizeArray(source.skillBar?.actions),
        { id: skillId, name: 'Basic Attack', mechanicKind: 'skill', skillId }
      ]
    },
    resources: {
      ...normalizeObject(source.resources),
      combat: {
        ...normalizeObject(source.resources?.combat),
        skillIds: compactUnique([...normalizeStringArray(source.resources?.combat?.skillIds), skillId]),
        featIds: compactUnique([...normalizeStringArray(source.resources?.combat?.featIds), defenseId]),
        statusIds: compactUnique([...normalizeStringArray(source.resources?.combat?.statusIds), dodgeId])
      }
    },
    normalActionPolicy: {
      actorId: enemyId,
      threatTier: tier,
      weights: stats.weights,
      attack: {
        modifier: attackModifier,
        damage: [{ type: stats.damageType, amount: stats.damageAmount }]
      },
      defense: {
        acBonus: stats.defenseAcBonus,
        temporaryHp: stats.defenseTemporaryHp,
        durationRounds: 1
      },
      dodge: {
        acBonus: stats.dodgeAcBonus,
        durationRounds: 1
      },
      source: 'combat-prepare-battle-default'
    },
    lootHints: normalizeArray(source.lootHints || source.loot || source.rewards).length
      ? normalizeArray(source.lootHints || source.loot || source.rewards)
      : defaultEnemyLootHints({ label: source.name || source.enemyLabel || source.title, tier, sourceText }),
    metadata: {
      ...normalizeObject(source.metadata),
      defaultCombatActionsInjected: true,
      sourceText
    }
  };
}

function buildPreparedEnemyObject({ index = 0, count = 1, label = '敌人', tier = 'minion', sceneId = 'current', sourceText = '', loot = [] } = {}) {
  const stats = defaultEnemyStatsForTier(tier);
  const baseId = safeActorId(`enemy_${index + 1}_${createId('enemy')}`, 'enemy');
  const lootHints = normalizeArray(loot).length
    ? normalizeArray(loot)
    : defaultEnemyLootHints({ label, tier, sourceText });
  return {
    enemyId: baseId,
    npcId: baseId,
    actorId: baseId,
    name: count > 1 ? `${label}${index + 1}` : label,
    actorType: 'monster',
    threatTier: tier,
    sceneId,
    values: {
      hp: stats.values.hp,
      maxHp: stats.values.maxHp,
      armorClass: stats.values.armorClass,
      speed: stats.values.speed,
      attackModifier: stats.attackModifier
    },
    lootHints,
    metadata: {
      preparedFromChat: true,
      preparedEnemyIndex: index,
      sourceText
    }
  };
}

function buildDefaultPlayerStatePatch({ chatSessionId, sceneId = 'current', actorId = 'pc_player', actorName = actorId, source = 'combat-prepare-battle' } = {}) {
  return {
    chatSessionId,
    sceneId,
    npcId: actorId,
    actorType: 'player',
    isPlayer: true,
    name: actorName,
    values: {
      hp: 10,
      maxHp: 10,
      armorClass: 10,
      speed: 30,
      attackModifier: 2
    },
    statusBar: {
      hp: 10,
      maxHp: 10,
      armorClass: 10
    },
    skillBar: {
      actions: [
        {
          id: 'basic_attack',
          name: 'Basic Attack',
          actionKind: 'attack',
          mode: 'attack',
          attack: {
            diceCount: 1,
            diceSides: 20,
            modifier: 2,
            criticalMode: 'd20'
          },
          damage: [{ type: 'bludgeoning', amount: 2 }]
        }
      ]
    },
    source
  };
}

function inferBattleName(sourceText = '', enemies = []) {
  const text = normalizeOptionalText(sourceText);
  if (text) return text.length > 24 ? `${text.slice(0, 24)}...` : text;
  const names = normalizeArray(enemies).map((enemy) => normalizeOptionalText(enemy.name || enemy.enemyId)).filter(Boolean);
  if (!names.length) return 'Battle';
  if (names.length === 1) return `Battle: ${names[0]}`;
  return `Battle: ${names[0]} x${names.length}`;
}

function inferEnemyCount(input = {}, sourceText = '') {
  const explicit = firstFiniteNumber(input.enemyCount, input.count, input.quantity);
  if (explicit !== undefined) return clampInteger(explicit, 1, 50);
  const text = String(sourceText || input.sourceText || input.text || input.content || '');
  const arabic = text.match(/(\d+)\s*(?:只|个|头|名|位|群|队)/u);
  if (arabic) return clampInteger(Number(arabic[1]), 1, 50);
  const chinese = text.match(/([一二两三四五六七八九十百]+)\s*(?:只|个|头|名|位|群|队)/u);
  if (chinese) return clampInteger(parseChineseInteger(chinese[1]), 1, 50);
  if (/(?:一群|一队|成群|些|几只|几个|数只|数个)/u.test(text)) return 3;
  return 1;
}

function inferEnemyLabel(input = {}, sourceText = '') {
  const explicit = normalizeOptionalText(input.enemyName || input.enemyLabel || input.name || input.title);
  if (explicit) return explicit;
  const text = String(sourceText || input.sourceText || input.text || input.content || '');
  const match = text.match(/(?:低级|普通|高阶|强大|精英|传奇|古老|小)?(妖兽|魔兽|怪物|守卫|强盗|盗匪|刺客|杀手|狼|虎|蛇|僵尸|亡灵|恶徒|敌人|敌兵|敌军|boss|monster|enemy)/iu);
  if (match) return match[1];
  if (/妖|魔|兽/u.test(text)) return '妖兽';
  return '敌人';
}

function inferEnemyName(source = {}, index = 0) {
  return normalizeOptionalText(source.enemyName || source.enemyLabel || source.name || source.title)
    || `Enemy ${index + 1}`;
}

function inferEnemyTier(input = {}, sourceText = '') {
  const explicit = normalizeOptionalText(input.threatTier || input.tier || input.rank);
  if (explicit) return explicit;
  const text = String(sourceText || input.sourceText || input.text || input.content || '');
  if (/古神|神明|天道|飞升|不可能|毁灭世界/u.test(text)) return 'mythic';
  if (/传奇|宗师|大能|元婴|化神|boss|首领|精英|强大|高阶/u.test(text)) return 'elite';
  if (/低级|普通|杂鱼|入门|弱小|小怪/u.test(text)) return 'minion';
  return 'trained';
}

function defaultEnemyStatsForTier(tier = 'trained') {
  const normalized = normalizeOptionalText(tier).toLowerCase();
  if (/(mythic|legend|ancient|god|古神|神明|天道)/i.test(normalized)) {
    return {
      values: { hp: 120, maxHp: 120, armorClass: 22, speed: 40 },
      attackModifier: 14,
      damageAmount: 24,
      damageType: 'force',
      defenseAcBonus: 6,
      defenseTemporaryHp: 30,
      dodgeAcBonus: 8,
      weights: { attack: 70, defense: 20, dodge: 10 }
    };
  }
  if (/(elite|boss|leader|精英|首领|高阶|传奇|宗师)/i.test(normalized)) {
    return {
      values: { hp: 36, maxHp: 36, armorClass: 15, speed: 30 },
      attackModifier: 6,
      damageAmount: 8,
      damageType: 'slashing',
      defenseAcBonus: 3,
      defenseTemporaryHp: 6,
      dodgeAcBonus: 4,
      weights: { attack: 65, defense: 25, dodge: 10 }
    };
  }
  if (/(minion|weak|low|低级|杂鱼|小怪|弱小)/i.test(normalized)) {
    return {
      values: { hp: 7, maxHp: 7, armorClass: 11, speed: 30 },
      attackModifier: 2,
      damageAmount: 2,
      damageType: 'slashing',
      defenseAcBonus: 1,
      defenseTemporaryHp: 1,
      dodgeAcBonus: 2,
      weights: { attack: 75, defense: 15, dodge: 10 }
    };
  }
  return {
    values: { hp: 12, maxHp: 12, armorClass: 12, speed: 30 },
    attackModifier: 3,
    damageAmount: 4,
    damageType: 'slashing',
    defenseAcBonus: 2,
    defenseTemporaryHp: 2,
    dodgeAcBonus: 3,
    weights: { attack: 70, defense: 20, dodge: 10 }
  };
}

function defaultEnemyLootHints({ label = '', tier = 'trained', sourceText = '' } = {}) {
  const text = `${label} ${sourceText}`.trim();
  const normalizedTier = normalizeOptionalText(tier).toLowerCase();
  const quantity = /(elite|boss|leader|精英|首领|高阶|传奇|宗师)/i.test(normalizedTier)
    ? 2
    : /(mythic|legend|ancient|god|古神|神明|天道)/i.test(normalizedTier)
      ? 4
      : 1;
  if (/妖兽|魔兽|妖|魔|兽/u.test(text)) {
    const name = defaultMonsterMaterialName({ text, tier });
    return [{
      id: defaultMonsterMaterialId(name),
      name,
      quantity,
      description: '可用于炼器、炼丹或出售的普通战斗素材。',
      tags: ['loot', 'material', 'monster'],
      metadata: {
        source: 'combat.default_enemy_loot',
        tier
      }
    }];
  }
  if (/狼|虎|蛇|野兽|beast|wolf|tiger|snake/i.test(text)) {
    return [{
      id: 'beast_material',
      name: '兽皮兽骨',
      quantity,
      description: '从野兽身上取得的基础材料。',
      tags: ['loot', 'material', 'beast'],
      metadata: {
        source: 'combat.default_enemy_loot',
        tier
      }
    }];
  }
  return [{
    id: 'battle_trophy',
    name: '战斗缴获',
    quantity,
    description: '按敌人类型生成的基础战利品占位；可由世界设定或 LLM aftermath 替换为更具体物品。',
    tags: ['loot'],
    metadata: {
      source: 'combat.default_enemy_loot',
      tier
    }
  }];
}

function defaultMonsterMaterialName({ text = '', tier = 'trained' } = {}) {
  const normalizedTier = normalizeOptionalText(tier).toLowerCase();
  const source = String(text || '');
  const kind = /魔兽/u.test(source)
    ? '魔兽'
    : /妖兽|妖/u.test(source)
      ? '妖兽'
      : '兽类';
  const tierLabel = /低级|低阶|弱小|小怪|杂鱼/u.test(source) || /(minion|weak|low)/i.test(normalizedTier)
    ? '低级'
    : /高阶|高等|精英|首领|宗师|传奇/u.test(source) || /(elite|boss|leader|legend)/i.test(normalizedTier)
      ? '高阶'
      : '';
  return `${tierLabel}${kind}素材`;
}

function defaultMonsterMaterialId(name = '') {
  if (/低级妖兽素材/u.test(name)) return 'low_grade_monster_material';
  if (/高阶妖兽素材/u.test(name)) return 'high_grade_monster_material';
  if (/妖兽素材/u.test(name)) return 'monster_material';
  if (/低级魔兽素材/u.test(name)) return 'low_grade_demon_beast_material';
  if (/高阶魔兽素材/u.test(name)) return 'high_grade_demon_beast_material';
  if (/魔兽素材/u.test(name)) return 'demon_beast_material';
  if (/低级兽类素材/u.test(name)) return 'low_grade_beast_material';
  if (/高阶兽类素材/u.test(name)) return 'high_grade_beast_material';
  return safeSegment(name || 'monster_material');
}

function normalizeBattleRewardItems(value = []) {
  return normalizeArray(value)
    .flatMap((entry) => {
      if (entry === undefined || entry === null || entry === '') return [];
      if (typeof entry === 'string') return [{ name: entry, quantity: 1 }];
      if (typeof entry === 'number') return [];
      const object = normalizeObject(entry);
      const kind = normalizeOptionalText(object.kind || object.type || object.category).toLowerCase();
      if (kind === 'currency' || object.currency) return [];
      const name = normalizeOptionalText(object.name || object.title || object.itemName || object.summary || object.id);
      if (!name) return [];
      const id = safeSegment(object.id || object.itemId || object.resourceId || name);
      return [{
        id,
        name,
        quantity: Math.max(1, firstFiniteNumber(object.quantity, object.count, object.amount, 1)),
        value: firstFiniteNumber(object.value),
        weight: firstFiniteNumber(object.weight),
        tags: normalizeStringArray(object.tags || kind),
        description: normalizeOptionalText(object.description || object.text || object.summary),
        metadata: {
          ...normalizeObject(object.metadata),
          rewardKind: kind || 'loot'
        }
      }];
    });
}

function normalizeBattleRewardCurrency(values = []) {
  const output = {};
  for (const value of normalizeArray(values)) {
    const object = normalizeObject(value);
    const currency = normalizeObject(object.currency || object);
    for (const [key, raw] of Object.entries(currency)) {
      const amount = Number(raw);
      if (!Number.isFinite(amount)) continue;
      const id = safeSegment(key);
      output[id] = (output[id] || 0) + amount;
    }
  }
  return output;
}

function selectBattleTargetFromText(sourceText = '', enemies = []) {
  const text = normalizeOptionalText(sourceText);
  if (!text) return undefined;
  const normalized = normalizeLooseMatchText(text);
  for (const enemy of enemies) {
    const data = enemy?.data || enemy || {};
    const labels = compactUnique([
      data.npcId,
      data.actorId,
      data.name,
      data.enemyId,
      enemy?.id
    ]).filter(Boolean);
    if (labels.some((label) => normalized.includes(normalizeLooseMatchText(label)))) return enemy;
  }
  const ordinal = text.match(/(?:第)?([一二两三四五六七八九十百]|\d+)\s*(?:只|个|头|名|号)?/u)?.[1];
  if (ordinal) {
    const index = clampInteger(/^\d+$/.test(ordinal) ? Number(ordinal) : parseChineseInteger(ordinal), 1, enemies.length) - 1;
    return enemies[index];
  }
  return undefined;
}

function normalizeLooseMatchText(value = '') {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{Script=Han}a-z0-9]+/gu, '');
}

function isActorAlive(actor = {}) {
  const data = actor?.data || actor || {};
  const conditions = normalizeStringArray(data.statusBar?.conditions || data.conditions).map((item) => item.toLowerCase());
  if (conditions.some((item) => ['dead', 'defeated', '死亡', '击败', '昏迷'].includes(item))) return false;
  if (normalizeArray(data.specialStatuses).some((status) => {
    const id = normalizeOptionalText(status.id || status.name).toLowerCase();
    return status.active !== false && ['dead', 'defeated', '死亡', '击败'].includes(id);
  })) return false;
  const hp = firstFiniteNumber(data.values?.hp, data.statusBar?.hp, data.hp);
  return hp === undefined ? true : hp > 0;
}

function looksLikeBattleEnemy(actor = {}, battle = {}) {
  const type = normalizeOptionalText(actor.actorType || actor.type).toLowerCase();
  if (['monster', 'enemy', 'hostile'].includes(type)) return true;
  const name = normalizeOptionalText(actor.name || actor.npcId || actor.actorId);
  if (!name) return false;
  const battleText = JSON.stringify({
    name: battle.name,
    objective: battle.objective,
    stakes: battle.stakes,
    sourceText: battle.sourceText,
    metadata: battle.metadata
  });
  return /妖兽|魔兽|怪物|敌人|monster|enemy/i.test(name) && /妖兽|魔兽|怪物|敌人|monster|enemy/i.test(battleText);
}

function mergeRewardInventory(current = {}, rewards = {}) {
  const base = normalizeInventoryShape(current);
  const currency = { ...base.currency };
  for (const [key, amount] of Object.entries(normalizeObject(rewards.currency))) {
    const number = Number(amount);
    if (!Number.isFinite(number)) continue;
    currency[key] = (Number(currency[key]) || 0) + number;
  }
  const byId = new Map(base.items.map((item) => [safeSegment(item.id || item.name), { ...item }]));
  for (const item of normalizeBattleRewardItems(rewards.items)) {
    const id = safeSegment(item.id || item.name);
    const previous = byId.get(id) || { id, name: item.name || id, quantity: 0 };
    byId.set(id, {
      ...previous,
      ...item,
      quantity: (Number(previous.quantity) || 0) + (Number(item.quantity) || 1)
    });
  }
  return {
    currency,
    items: [...byId.values()]
  };
}

function normalizeInventoryShape(inventory = {}) {
  const source = normalizeObject(inventory);
  return {
    currency: Object.fromEntries(Object.entries(normalizeObject(source.currency)).map(([key, value]) => [safeSegment(key), Number(value) || 0])),
    items: normalizeArray(source.items)
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item) && (item.id || item.name))
      .map((item) => ({
        ...item,
        id: safeSegment(item.id || item.name),
        name: normalizeOptionalText(item.name || item.id),
        quantity: Math.max(0, firstFiniteNumber(item.quantity, item.count, 1))
      }))
  };
}

function normalizeAftermathToolCalls(aftermath = {}, defaults = {}) {
  const source = normalizeObject(aftermath);
  const calls = [
    ...normalizeArray(source.toolCalls),
    ...normalizeArray(source.effectEnvelope?.toolCalls),
    ...normalizeArray(source.influencePlan?.toolCalls),
    ...normalizeArray(source.influencePlan?.npcUpdates),
    ...normalizeArray(source.influencePlan?.factionUpdates),
    ...normalizeArray(source.influencePlan?.mapUpdates),
    ...normalizeArray(source.influencePlan?.questOrEncounterHooks)
  ];
  return calls
    .map((call, index) => normalizeAftermathToolCall(call, defaults, index))
    .filter(Boolean);
}

function normalizeAftermathToolCall(call = {}, defaults = {}, index = 0) {
  const source = normalizeObject(call);
  const tool = normalizeOptionalText(source.tool || source.toolId || source.name);
  if (!tool || tool === 'system.npc_state.patch_state') return undefined;
  const input = {
    ...normalizeObject(source.input || source.args || source.parameters),
    chatSessionId: source.input?.chatSessionId || source.chatSessionId || defaults.chatSessionId,
    sceneId: source.input?.sceneId || source.sceneId || defaults.sceneId,
    source: source.input?.source || source.source || 'combat-aftermath'
  };
  return {
    id: normalizeOptionalText(source.id || source.callId) || `aftermath_tool_${index + 1}`,
    tool,
    input: removeUndefined(input),
    reason: normalizeOptionalText(source.reason || source.summary || source.description)
  };
}

function compactUnique(values = []) {
  return [...new Set(normalizeArray(values)
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => normalizeOptionalText(value))
    .filter(Boolean))];
}

function clampInteger(value, min, max) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function parseChineseInteger(value = '') {
  const text = String(value || '').trim();
  const digitMap = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  };
  if (text === '十') return 10;
  if (text.includes('百')) {
    const [hundreds, rest] = text.split('百');
    return (digitMap[hundreds] || 1) * 100 + (rest ? parseChineseInteger(rest) : 0);
  }
  if (text.includes('十')) {
    const [tens, ones] = text.split('十');
    return (tens ? digitMap[tens] || 1 : 1) * 10 + (ones ? digitMap[ones] || 0 : 0);
  }
  return digitMap[text] || 1;
}

export function buildCombatStartPrompt({ sourceText = '', text, content, context = {}, userRules = '', startPrompt = '', decisionTemplate = COMBAT_START_DECISION_TEMPLATE } = {}) {
  return [
    startPrompt || [
      'You judge whether a scene should enter battle/combat.',
      'Only decide if combat starts, who is involved, and what the immediate objective/stakes are.',
      'Do not roll dice, spend resources, deal damage, or mutate state.',
      'Return JSON only.'
    ].join('\n'),
    userRules ? `User combat start rules:\n${userRules}` : '',
    'Scene/action text:',
    String(sourceText || text || content || ''),
    'Collected context:',
    JSON.stringify(context || {}, null, 2),
    'Return one combat start decision JSON object using this reference shape:',
    JSON.stringify(decisionTemplate, null, 2)
  ].filter(Boolean).join('\n\n');
}

export function buildCombatSpecialPrompt({ sourceText = '', text, content, battle, context = {}, userRules = '', specialPrompt = '', judgementTemplate = COMBAT_SPECIAL_JUDGEMENT_TEMPLATE } = {}) {
  return [
    specialPrompt || [
      'You route a special non-option combat action for an RPG.',
      'Normal attacks, movement, resource use, damage, healing, and status settlement do not need LLM.',
      'Use this only for unusual combat behavior, special textual item/skill descriptions, impossible claims, social actions inside battle, or cinematic stunts.',
      'Do not roll dice or mutate state. Decide what deterministic tool flow should happen next and what resources should be spent after the ruling.',
      'Calling this judgement does not consume resources by itself.',
      'Return JSON only.'
    ].join('\n'),
    userRules ? `User special-combat rules:\n${userRules}` : '',
    'Special action text:',
    String(sourceText || text || content || ''),
    battle ? `Battle:\n${JSON.stringify(battle, null, 2)}` : '',
    'Collected context:',
    JSON.stringify(context || {}, null, 2),
    'Return one combat special judgement JSON object using this reference shape:',
    JSON.stringify(judgementTemplate, null, 2)
  ].filter(Boolean).join('\n\n');
}

export function buildCombatAftermathPrompt({ sourceText = '', text, content, battle, outcome = '', context = {}, userRules = '', aftermathPrompt = '', aftermathTemplate = COMBAT_AFTERMATH_TEMPLATE } = {}) {
  return [
    aftermathPrompt || [
      'You plan battle aftermath for an RPG.',
      'Handle rewards, loot hints, NPC consequences, faction influence, map/quest hooks, and narrative summary.',
      'Do not directly mutate state. Return proposals that other tools or the UI can inspect and apply.',
      'Rewards should match difficulty, risk, process, opponent resources, and victory quality.',
      'Return JSON only.'
    ].join('\n'),
    userRules ? `User aftermath rules:\n${userRules}` : '',
    `Battle outcome: ${outcome || battle?.status || 'ended'}`,
    'Battle:',
    JSON.stringify(battle || {}, null, 2),
    'End text:',
    String(sourceText || text || content || ''),
    'Collected context:',
    JSON.stringify(context || {}, null, 2),
    'Return one combat aftermath JSON object using this reference shape:',
    JSON.stringify(aftermathTemplate, null, 2)
  ].filter(Boolean).join('\n\n');
}

function normalizeBattleRecord(input = {}, { now = () => new Date().toISOString() } = {}) {
  const timestamp = now();
  const battleId = safeSegment(input.battleId || input.id || input.name || createId('battle'));
  return {
    chatSessionId: normalizeRequiredText(input.chatSessionId, 'chatSessionId'),
    battleId,
    sceneId: normalizeOptionalText(input.sceneId) || 'current',
    name: normalizeOptionalText(input.name || input.title || input.battleName) || battleId,
    status: normalizeCombatStatus(input.status || 'active'),
    participantIds: normalizeStringArray(input.participantIds),
    enemyIds: normalizeStringArray(input.enemyIds),
    allyIds: normalizeStringArray(input.allyIds),
    objective: normalizeOptionalText(input.objective),
    stakes: normalizeOptionalText(input.stakes),
    startDecision: normalizeObject(input.startDecision),
    aftermath: normalizeObject(input.aftermath),
    metadata: normalizeObject(input.metadata),
    createdAtIso: normalizeOptionalText(input.createdAtIso) || timestamp,
    startedAt: normalizeOptionalText(input.startedAt) || timestamp,
    endedAt: normalizeOptionalText(input.endedAt),
    combatUpdatedAt: timestamp
  };
}

function normalizeCombatEvent(input = {}, { now = () => new Date().toISOString() } = {}) {
  return {
    chatSessionId: normalizeRequiredText(input.chatSessionId, 'chatSessionId'),
    eventId: safeSegment(input.eventId || input.id || createId('combatevent')),
    battleId: normalizeOptionalText(input.battleId),
    sceneId: normalizeOptionalText(input.sceneId) || 'current',
    eventType: normalizeOptionalText(input.eventType || input.type) || 'note',
    actorId: normalizeOptionalText(input.actorId || input.npcId || input.playerId),
    targetIds: normalizeStringArray(input.targetIds || input.targetId || input.targets),
    sourceText: normalizeOptionalText(input.sourceText || input.text || input.content),
    summary: normalizeOptionalText(input.summary),
    result: normalizeObject(input.result),
    metadata: normalizeObject(input.metadata),
    createdAtIso: now()
  };
}

function normalizeCombatAction(input = {}) {
  const actorId = normalizeRequiredText(input.actorId || input.npcId || input.playerId, 'actorId');
  return {
    actionId: safeSegment(input.actionId || input.id || createId('combataction')),
    battleId: normalizeOptionalText(input.battleId),
    chatSessionId: normalizeRequiredText(input.chatSessionId, 'chatSessionId'),
    sceneId: normalizeOptionalText(input.sceneId) || 'current',
    actorId,
    targetIds: normalizeStringArray(input.targetIds || input.targetId || input.targetNpcId || input.targets || input.target).map(safeSegment),
    actionKind: normalizeOptionalText(input.actionKind || input.kind || input.type) || 'attack',
    sourceText: normalizeOptionalText(input.sourceText || input.text || input.content),
    metadata: normalizeObject(input.metadata)
  };
}

function normalizeCostPlan(input = {}, action) {
  const costs = [];
  const rawCosts = normalizeArray(input.resourceCosts || input.costs);
  if (input.consumeAction !== false && !rawCosts.some((cost) => normalizeObject(cost).kind === 'actionEconomy')) {
    costs.push({ kind: 'actionEconomy', resource: input.actionResource || 'action', amount: 1 });
  }
  for (const raw of rawCosts) {
    const cost = normalizeObject(raw);
    costs.push({
      kind: normalizeOptionalText(cost.kind || cost.costType || (cost.category ? 'resource' : 'resource')) || 'resource',
      resource: normalizeOptionalText(cost.resource || cost.actionType),
      category: normalizeOptionalText(cost.category || cost.resourceType || cost.type),
      resourceId: normalizeOptionalText(cost.resourceId || cost.id || cost.name || cost.itemId),
      itemId: normalizeOptionalText(cost.itemId || cost.resourceId || cost.id),
      itemName: normalizeOptionalText(cost.itemName || cost.name),
      amount: normalizeNumber(cost.amount ?? cost.value ?? cost.quantity ?? 1, 'cost.amount'),
      syncInventory: cost.syncInventory,
      removeWhenZero: cost.removeWhenZero,
      allowOverspend: cost.allowOverspend
    });
  }
  if (input.ammoCost || input.ammoResourceId) {
    costs.push({
      kind: 'resource',
      category: 'ammo',
      resourceId: normalizeOptionalText(input.ammoResourceId || input.ammoCost?.resourceId || input.ammoCost?.id),
      amount: normalizeNumber(input.ammoAmount ?? input.ammoCost?.amount ?? 1, 'ammoAmount')
    });
  }
  if (input.consumableCost || input.consumableId) {
    costs.push({
      kind: 'consumeItem',
      category: 'consumables',
      resourceId: normalizeOptionalText(input.consumableId || input.consumableCost?.resourceId || input.consumableCost?.id),
      itemId: normalizeOptionalText(input.consumableId || input.consumableCost?.itemId || input.consumableCost?.id),
      amount: normalizeNumber(input.consumableAmount ?? input.consumableCost?.amount ?? 1, 'consumableAmount')
    });
  }
  return {
    actorId: action.actorId,
    spendAfterResolution: true,
    costs: costs.filter((cost) => cost.kind && (cost.kind === 'actionEconomy' || cost.resourceId || cost.itemId || cost.category))
  };
}

function normalizeAttackInput(input = {}, action) {
  const object = normalizeObject(input);
  return {
    successThreshold: normalizeInteger(object.successThreshold ?? object.dc ?? object.target ?? object.targetAc ?? object.ac ?? 10, 'attack.successThreshold'),
    diceCount: normalizeInteger(object.diceCount ?? object.rollCount ?? 1, 'attack.diceCount'),
    diceSides: normalizeInteger(object.diceSides ?? object.sides ?? 20, 'attack.diceSides'),
    modifier: normalizeInteger(object.modifier ?? object.fixedModifier ?? 0, 'attack.modifier'),
    buff: object.buff,
    debuff: object.debuff,
    abilityModifier: object.abilityModifier,
    proficiencyBonus: object.proficiencyBonus,
    modifiers: object.modifiers,
    forceMode: object.forceMode,
    rollMode: object.rollMode,
    inspirationPoints: object.inspirationPoints,
    criticalMode: object.criticalMode || 'd20'
  };
}

function normalizeHitResult(input = {}) {
  if (typeof input === 'boolean') return { outcome: input ? 'hit' : 'miss', hit: input, critical: false };
  if (typeof input === 'string') {
    const normalized = input.toLowerCase();
    return { outcome: normalized, hit: ['hit', 'success', 'criticalsuccess', 'critical_success'].includes(normalized), critical: normalized.includes('critical') };
  }
  const object = normalizeObject(input);
  const outcome = normalizeOptionalText(object.outcome || object.result || object.status) || (object.success ? 'success' : object.hit ? 'hit' : 'miss');
  const criticalSuccess = object.criticalSuccess === true || outcome === 'criticalSuccess';
  const criticalFailure = object.criticalFailure === true || outcome === 'criticalFailure';
  const hit = object.hit ?? object.success ?? (criticalSuccess || ['hit', 'success'].includes(outcome));
  return {
    outcome,
    hit: Boolean(hit),
    miss: !hit,
    critical: object.critical ?? (criticalSuccess || criticalFailure),
    criticalSuccess,
    criticalFailure,
    total: object.total,
    successThreshold: object.successThreshold,
    margin: object.margin ?? (object.total !== undefined && object.successThreshold !== undefined ? object.total - object.successThreshold : undefined)
  };
}

function normalizeDamageItems(value = []) {
  return normalizeArray(value)
    .filter((item) => item !== undefined && item !== null && item !== '')
    .map((item) => typeof item === 'number'
      ? { type: 'damage', amount: item }
      : {
        ...normalizeObject(item),
        type: normalizeOptionalText(item.type || item.damageType) || 'damage',
        amount: normalizeNumber(item.amount ?? item.total ?? item.value ?? 0, 'damage.amount')
      });
}

function normalizeDamageRolls(value = []) {
  return normalizeArray(value)
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      type: normalizeOptionalText(item.type || item.damageType) || 'damage',
      diceCount: normalizeInteger(item.diceCount ?? item.count ?? 1, 'damageRoll.diceCount'),
      diceSides: normalizeInteger(item.diceSides ?? item.sides, 'damageRoll.diceSides'),
      modifier: normalizeInteger(item.modifier ?? 0, 'damageRoll.modifier'),
      criticalMode: normalizeOptionalText(item.criticalMode)
    }));
}

function buildSettlementInput(action, input, attack, damage) {
  const targets = action.targetIds.length ? action.targetIds : normalizeStringArray(input.targetId || input.npcId);
  return {
    chatSessionId: action.chatSessionId,
    sceneId: action.sceneId,
    settlementId: input.settlementId,
    sourceActionId: action.actionId,
    source: 'combat-manager',
    targets: targets.map((targetId) => ({
      npcId: targetId,
      hit: {
        outcome: attack.outcome,
        hit: attack.hit,
        critical: attack.critical || attack.criticalSuccess
      },
      damage,
      healing: input.healing || input.heals,
      temporaryHp: input.temporaryHp || input.tempHp,
      statusEffects: input.statusEffects || input.statuses || input.conditions,
      defenses: input.defenses,
      resistances: input.resistances,
      vulnerabilities: input.vulnerabilities,
      immunities: input.immunities,
      applyDamageOnMiss: input.applyDamageOnMiss
    })),
    damage,
    healing: normalizeArray(input.healing || input.heals),
    statusEffects: normalizeArray(input.statusEffects || input.statuses || input.conditions)
  };
}

function buildEnemyAttackActionInput({ input = {}, actorId, targetId, targetState = {}, payload = {} } = {}) {
  const targetAc = firstFiniteNumber(
    input.targetAc,
    input.ac,
    payload.successThreshold,
    resolveArmorClass(targetState),
    10
  );
  return removeUndefined({
    chatSessionId: input.chatSessionId,
    sceneId: input.sceneId || 'current',
    battleId: input.battleId,
    actionId: input.actionId,
    actorId,
    targetId,
    actionKind: 'attack',
    sourceText: input.sourceText || input.text || input.content || 'ordinary enemy attack',
    dryRun: Boolean(input.dryRun),
    consumeAction: input.consumeAction,
    recordEvent: input.recordEvent,
    attack: {
      successThreshold: targetAc,
      diceCount: payload.diceCount || 1,
      diceSides: payload.diceSides || 20,
      modifier: payload.modifier || 0,
      forceMode: payload.forceMode || input.forceMode,
      rollMode: payload.rollMode || input.rollMode,
      inspirationPoints: payload.inspirationPoints ?? input.inspirationPoints,
      criticalMode: payload.criticalMode || input.criticalMode || 'd20'
    },
    damage: payload.damage,
    damageRolls: payload.damageRolls,
    criticalDamageMultiplier: payload.criticalDamageMultiplier,
    applyDamageOnMiss: payload.applyDamageOnMiss,
    resourceCosts: payload.resourceCosts,
    metadata: {
      ...normalizeObject(input.metadata),
      ordinaryEnemyAction: true,
      targetAc,
      targetPolicy: payload.targetPolicy
    }
  });
}

function buildOrdinaryDefenseSettlementInput({ chatSessionId, sceneId, actorId, payload = {}, statePatch = {} } = {}) {
  const target = removeUndefined({
    npcId: actorId,
    hit: { outcome: 'hit', hit: true, source: 'ordinary-defense' },
    temporaryHp: payload.temporaryHp || payload.tempHp
      ? { amount: payload.temporaryHp ?? payload.tempHp, mode: 'max' }
      : undefined,
    statusEffects: statePatch.specialStatuses || []
  });
  return {
    chatSessionId,
    sceneId,
    source: 'combat-ordinary-turn',
    targets: [target]
  };
}

function resolveEnemyTurnTargetId(input = {}, payload = {}) {
  return normalizeOptionalText(
    input.targetId
    || input.targetNpcId
    || normalizeStringArray(input.targetIds)[0]
    || normalizeStringArray(input.targets)[0]
    || payload.targetId
    || payload.targetNpcId
  );
}

function resolveArmorClass(actor = {}) {
  const values = normalizeObject(actor.values);
  const statusBar = normalizeObject(actor.statusBar);
  const base = firstFiniteNumber(
    actor.targetAc,
    actor.ac,
    actor.armorClass,
    values.armorClass,
    values.ac,
    statusBar.armorClass,
    statusBar.ac,
    10
  );
  const statusBonus = normalizeArray(actor.specialStatuses)
    .filter((status) => status?.active !== false)
    .reduce((sum, status) => sum + (Number(status.metadata?.acBonus) || 0), 0);
  const modifierBonus = Object.values(normalizeObject(statusBar.combatModifiers))
    .reduce((sum, modifier) => sum + (Number(normalizeObject(modifier).acBonus) || 0), 0);
  return base + statusBonus + modifierBonus;
}

function hasExplicitSuccessThreshold(input = {}) {
  const object = normalizeObject(input);
  return object.successThreshold !== undefined
    || object.dc !== undefined
    || object.target !== undefined
    || object.targetAc !== undefined
    || object.ac !== undefined;
}

function collectDamageTypes(value = []) {
  return normalizeArray(value)
    .flatMap((item) => {
      if (typeof item === 'string') return item.split(',');
      if (item && typeof item === 'object' && !Array.isArray(item)) return [item.type, item.damageType, item.element];
      return [];
    })
    .map((item) => normalizeOptionalText(item).toLowerCase())
    .filter(Boolean);
}

function mergeDefenses(base = {}, update = {}) {
  const merge = (left, right) => [...new Set([
    ...normalizeStringArray(left).map((item) => item.toLowerCase()),
    ...normalizeStringArray(right).map((item) => item.toLowerCase())
  ].filter(Boolean))];
  return {
    ...normalizeObject(base),
    ...normalizeObject(update),
    resistances: merge(base.resistances || base.resistance, update.resistances || update.resistance),
    vulnerabilities: merge(base.vulnerabilities || base.vulnerability, update.vulnerabilities || update.vulnerability),
    immunities: merge(base.immunities || base.immunity, update.immunities || update.immunity)
  };
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function validateOneCost(snapshot, cost) {
  if (cost.kind === 'actionEconomy') {
    const pool = snapshot.actionEconomy?.[cost.resource || 'action'];
    const available = normalizeNumber(pool?.current ?? 0, 'available');
    return { cost, ok: available >= cost.amount, available, requested: cost.amount };
  }
  const category = cost.kind === 'consumeItem' ? 'consumables' : cost.category;
  const resourceId = cost.resourceId || cost.itemId;
  const resource = snapshot.resources?.[category]?.[resourceId];
  const available = normalizeNumber(resource?.current ?? 0, 'available');
  return { cost, ok: available >= cost.amount, available, requested: cost.amount };
}

function normalizeStartDecision(input = {}, source = {}) {
  const object = normalizeObject(input);
  const shouldStartBattle = object.shouldStartBattle ?? object.startBattle ?? object.shouldStart ?? true;
  return {
    decisionId: normalizeOptionalText(object.decisionId || object.id) || createId('combatstart'),
    status: normalizeOptionalText(object.status) || 'judged',
    shouldStartBattle: Boolean(shouldStartBattle),
    battleName: normalizeOptionalText(object.battleName || object.name || source.name || source.battleName) || 'Battle',
    reason: normalizeOptionalText(object.reason || object.summary),
    participantIds: normalizeStringArray(object.participantIds || source.participantIds),
    allyIds: normalizeStringArray(object.allyIds || source.allyIds),
    enemyIds: normalizeStringArray(object.enemyIds || source.enemyIds),
    objective: normalizeOptionalText(object.objective || source.objective),
    stakes: normalizeOptionalText(object.stakes || source.stakes),
    recommendedOpening: normalizeOptionalText(object.recommendedOpening),
    metadata: normalizeObject(object.metadata)
  };
}

function normalizeSpecialJudgement(input = {}, source = {}) {
  const object = normalizeObject(input);
  return {
    judgementId: normalizeOptionalText(object.judgementId || object.id) || createId('combatspecial'),
    status: normalizeOptionalText(object.status) || 'judged',
    actionText: normalizeOptionalText(object.actionText || source.sourceText || source.text || source.content),
    actionMode: normalizeOptionalText(object.actionMode || object.mode) || 'narrativeOnly',
    consumesResourcesAfterResolution: object.consumesResourcesAfterResolution !== false,
    resourceCosts: normalizeArray(object.resourceCosts || object.costs).map(normalizeObject),
    combatAction: normalizeObject(object.combatAction || object.action),
    explanationNeeded: object.explanationNeeded === true,
    summary: normalizeOptionalText(object.summary || object.reason),
    rulingGuidance: normalizeOptionalText(object.rulingGuidance || object.narrationGuidance),
    followUpHooks: normalizeStringArray(object.followUpHooks),
    metadata: normalizeObject(object.metadata)
  };
}

function normalizeAftermath(input = {}, source = {}) {
  const object = normalizeObject(input);
  return {
    aftermathId: normalizeOptionalText(object.aftermathId || object.id) || createId('combataftermath'),
    status: normalizeOptionalText(object.status) || 'planned',
    battleId: normalizeOptionalText(object.battleId || source.battleId),
    outcome: normalizeCombatStatus(object.outcome || source.outcome || 'ended'),
    rewardPlan: normalizeObject(object.rewardPlan || object.rewards),
    influencePlan: normalizeObject(object.influencePlan || object.influence),
    narrativeSummary: normalizeOptionalText(object.narrativeSummary || object.summary),
    metadata: normalizeObject(object.metadata)
  };
}

function buildActionSummary(result) {
  if (result.attack?.hit) return `Combat action hit: ${result.action.actorId} -> ${result.action.targetIds.join(', ')}`;
  return `Combat action resolved: ${result.action.actorId} -> ${result.action.targetIds.join(', ') || 'no target'}`;
}

function safeGetBattle(combat, action) {
  try {
    return combat.getBattle({ chatSessionId: action.chatSessionId, battleId: action.battleId });
  } catch {
    return undefined;
  }
}

async function safeExecuteTool(toolManager, tool, input) {
  try {
    return {
      ok: true,
      output: (await toolManager.executeTool(tool, removeUndefined(input), undefined, { audit: { skipAudit: true } })).output
    };
  } catch (error) {
    return {
      ok: false,
      error: serializeError(error)
    };
  }
}

async function generateJson({ chatProvider, prompt, system, temperature, maxTokens, missingMessage }) {
  if (!chatProvider || typeof chatProvider.generate !== 'function') throw validationError(missingMessage);
  const completion = await chatProvider.generate({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ],
    temperature,
    maxTokens
  });
  return {
    json: parseJsonObject(completion.content),
    content: completion.content,
    raw: completion.raw
  };
}

function parseJsonObject(content) {
  try {
    return parseFirstJsonObject(content);
  } catch {
    throw validationError('Combat LLM did not return a JSON object');
  }
}

function normalizeCombatStatus(value) {
  const normalized = normalizeOptionalText(value) || 'active';
  if (normalized === 'victory') return 'won';
  if (normalized === 'defeat') return 'lost';
  if (normalized === 'resolved') return 'won';
  return normalized;
}

function battleRecordId(battleId) {
  return `combatbattle_${safeSegment(battleId)}`.slice(0, 128);
}

function eventRecordId(eventId) {
  return `combatevent_${safeSegment(eventId)}`.slice(0, 128);
}

function safeSegment(value) {
  return normalizeRequiredText(value, 'id')
    .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'id';
}

function safeActorId(value, fallback = 'actor') {
  const text = normalizeOptionalText(value)
    .normalize('NFKC')
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
  return text || `${fallback}_${createId(fallback)}`;
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

function normalizeSearchText(value) {
  return String(value || '').toLowerCase().trim();
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

function normalizeNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw validationError(`${field} must be a finite number`);
  return number;
}

function normalizeInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number)) throw validationError(`${field} must be an integer`);
  return number;
}

function removeUndefined(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined && child !== ''));
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    statusCode: error?.statusCode
  };
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'CombatManagerValidationError';
  error.statusCode = 400;
  return error;
}
