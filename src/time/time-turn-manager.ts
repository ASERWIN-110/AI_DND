// @ts-nocheck
import { randomInt } from 'node:crypto';
import YAML from 'yaml';
import { runDiceCheck } from '../dice/dice-engine.js';
import { documentToCollections, parseStructuredDocument } from '../data/structured-document-importer.js';
import { StructuredInterfaceTraceRecorder } from '../structured/structured-interface.js';
import { parseFirstJsonObject } from '../utils/json.js';

export const TIME_CLOCKS_COLLECTION = 'time_clocks';
export const TIME_ENCOUNTERS_COLLECTION = 'time_encounters';
export const TIME_TURN_ORDER_COLLECTION = 'time_turn_order';
export const TIME_EFFECTS_COLLECTION = 'time_effects';
export const TIME_EVENTS_COLLECTION = 'time_events';
export const TIME_INTERPRETER_SETTINGS_COLLECTION = 'time_interpreter_settings';
export const TIME_WORLD_CLOCKS_COLLECTION = 'time_world_clocks';

export const TIME_CLOCK_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id. Duplicated for readable exports.' },
  { name: 'clockId', type: 'text', description: 'Logical clock id. The default active clock is "active".' },
  { name: 'sceneId', type: 'text', description: 'Current scene id or label.' },
  { name: 'phase', type: 'text', description: 'narrative, scene, round, turn, downtime, rest, paused, etc.' },
  { name: 'calendar', type: 'json', description: 'Optional in-world calendar fields.' },
  { name: 'elapsedSeconds', type: 'integer', description: 'Campaign-local elapsed seconds.' },
  { name: 'roundNumber', type: 'integer', description: 'Current encounter round number.' },
  { name: 'turnNumber', type: 'integer', description: 'Total turns advanced in this chat.' },
  { name: 'activeEncounterId', type: 'text', description: 'Current active encounter id, if any.' },
  { name: 'roundDurationSeconds', type: 'integer', description: 'Seconds represented by one combat/exchange round.' },
  { name: 'source', type: 'text', description: 'manual, agent, import, system, etc.' },
  { name: 'clockUpdatedAt', type: 'text', description: 'Latest clock update timestamp.' }
];

export const TIME_ENCOUNTER_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id.' },
  { name: 'encounterId', type: 'text', description: 'Stable encounter id.' },
  { name: 'sceneId', type: 'text', description: 'Scene id or label.' },
  { name: 'name', type: 'text', description: 'Display name.' },
  { name: 'mode', type: 'text', description: 'combat, exploration, chase, social, downtime, etc.' },
  { name: 'status', type: 'text', description: 'active, paused, ended, archived.' },
  { name: 'roundNumber', type: 'integer', description: 'Current round in this encounter.' },
  { name: 'turnIndex', type: 'integer', description: 'Index into the active turn order.' },
  { name: 'currentParticipantId', type: 'text', description: 'Participant whose turn is current.' },
  { name: 'roundDurationSeconds', type: 'integer', description: 'Seconds represented by one round.' },
  { name: 'participantIds', type: 'json', description: 'Current participant id list for fast inspection.' },
  { name: 'metadata', type: 'json', description: 'Encounter metadata.' },
  { name: 'startedAt', type: 'text', description: 'Encounter start timestamp.' },
  { name: 'endedAt', type: 'text', description: 'Encounter end timestamp.' },
  { name: 'encounterUpdatedAt', type: 'text', description: 'Latest encounter update timestamp.' }
];

export const TIME_TURN_ORDER_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id.' },
  { name: 'encounterId', type: 'text', description: 'Owning encounter id.' },
  { name: 'sceneId', type: 'text', description: 'Scene id or label.' },
  { name: 'participantId', type: 'text', description: 'Stable participant id.' },
  { name: 'name', type: 'text', description: 'Display name.' },
  { name: 'actorType', type: 'text', description: 'player, npc, monster, hazard, lair, system, etc.' },
  { name: 'initiative', type: 'number', description: 'Initiative score used for ordering.' },
  { name: 'initiativeRoll', type: 'json', description: 'Optional dice roll details.' },
  { name: 'dexterityModifier', type: 'integer', description: 'Tie-breaker and D&D-style initiative modifier.' },
  { name: 'orderIndex', type: 'integer', description: 'Stable order index after sorting.' },
  { name: 'status', type: 'text', description: 'active, waiting, delayed, defeated, removed, inactive.' },
  { name: 'hasActed', type: 'integer', description: 'Boolean 0/1 flag for current round.' },
  { name: 'actionState', type: 'json', description: 'Action, bonus action, reaction, movement, or custom action economy.' },
  { name: 'tags', type: 'json', description: 'Participant tags.' },
  { name: 'metadata', type: 'json', description: 'Participant metadata.' },
  { name: 'turnStartedAt', type: 'text', description: 'Latest turn start timestamp.' },
  { name: 'turnUpdatedAt', type: 'text', description: 'Latest turn order update timestamp.' }
];

export const TIME_EFFECT_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id.' },
  { name: 'encounterId', type: 'text', description: 'Optional encounter id.' },
  { name: 'sceneId', type: 'text', description: 'Scene id or label.' },
  { name: 'effectId', type: 'text', description: 'Stable effect id.' },
  { name: 'name', type: 'text', description: 'Display name.' },
  { name: 'effectType', type: 'text', description: 'buff, debuff, condition, spell, cooldown, concentration, environmental, etc.' },
  { name: 'ownerParticipantId', type: 'text', description: 'Effect owner/source participant.' },
  { name: 'targetParticipantId', type: 'text', description: 'Effect target participant.' },
  { name: 'status', type: 'text', description: 'active, suspended, expired, removed.' },
  { name: 'durationType', type: 'text', description: 'rounds, turns, seconds, scene, permanent.' },
  { name: 'remainingRounds', type: 'integer', description: 'Remaining rounds for round-based effects.' },
  { name: 'remainingSeconds', type: 'integer', description: 'Remaining seconds for time-based effects.' },
  { name: 'tickTiming', type: 'text', description: 'startTurn, endTurn, endRound, advanceTime, manual.' },
  { name: 'values', type: 'json', description: 'Numeric modifiers or counters.' },
  { name: 'metadata', type: 'json', description: 'Effect metadata.' },
  { name: 'source', type: 'text', description: 'manual, agent, import, spell, item, etc.' },
  { name: 'createdAtIso', type: 'text', description: 'Effect creation timestamp.' },
  { name: 'effectUpdatedAt', type: 'text', description: 'Latest effect update timestamp.' }
];

export const TIME_EVENT_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id.' },
  { name: 'encounterId', type: 'text', description: 'Optional encounter id.' },
  { name: 'sceneId', type: 'text', description: 'Scene id or label.' },
  { name: 'eventId', type: 'text', description: 'Stable event id.' },
  { name: 'title', type: 'text', description: 'Display title.' },
  { name: 'description', type: 'text', description: 'Short event description.' },
  { name: 'status', type: 'text', description: 'scheduled, due, resolved, cancelled.' },
  { name: 'triggerType', type: 'text', description: 'elapsedSeconds, round, turn, manual.' },
  { name: 'dueElapsedSeconds', type: 'integer', description: 'Due when clock elapsedSeconds reaches this value.' },
  { name: 'dueRound', type: 'integer', description: 'Due when encounter round reaches this value.' },
  { name: 'dueTurnIndex', type: 'integer', description: 'Optional turn index in dueRound.' },
  { name: 'payload', type: 'json', description: 'Structured event payload.' },
  { name: 'metadata', type: 'json', description: 'Event metadata.' },
  { name: 'source', type: 'text', description: 'manual, agent, import, system, etc.' },
  { name: 'createdAtIso', type: 'text', description: 'Event creation timestamp.' },
  { name: 'resolvedAt', type: 'text', description: 'Resolution timestamp.' },
  { name: 'eventUpdatedAt', type: 'text', description: 'Latest event update timestamp.' }
];

export const TIME_INTERPRETER_SETTING_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id.' },
  { name: 'settingsId', type: 'text', description: 'Settings record id. The default active settings id is "active".' },
  { name: 'enabled', type: 'integer', description: 'Whether rule-based time interpretation is enabled.' },
  { name: 'llmEnabled', type: 'integer', description: 'Whether the optional LLM estimation layer may be used.' },
  { name: 'timeEstimationEnabled', type: 'integer', description: 'Whether fuzzy narrative text may be converted into elapsed seconds. Disabled by default.' },
  { name: 'autoApply', type: 'integer', description: 'Reserved switch for future automatic tool application. Current interpreter returns proposals only.' },
  { name: 'confidenceThreshold', type: 'number', description: 'Confidence at or above this value does not need confirmation.' },
  { name: 'confirmationThreshold', type: 'number', description: 'Confidence below this value should be treated as low confidence.' },
  { name: 'rules', type: 'json', description: 'Rule pack used before optional LLM estimation.' },
  { name: 'source', type: 'text', description: 'manual, import, system, etc.' },
  { name: 'settingsUpdatedAt', type: 'text', description: 'Latest settings update timestamp.' }
];

export const TIME_WORLD_CLOCK_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id.' },
  { name: 'worldClockId', type: 'text', description: 'Logical world clock id. The default active world clock is "active".' },
  { name: 'sceneId', type: 'text', description: 'Scene id or scope this pulse clock is attached to.' },
  { name: 'name', type: 'text', description: 'Display name.' },
  { name: 'enabled', type: 'integer', description: 'Whether this world clock may produce pulses.' },
  { name: 'status', type: 'text', description: 'active, paused, archived, etc.' },
  { name: 'llmEnabled', type: 'integer', description: 'Whether optional LLM world-pulse generation may be used.' },
  { name: 'autoSchedule', type: 'integer', description: 'Reserved UI/loop switch. Tools still require explicit run_world_pulse execution.' },
  { name: 'intervalSeconds', type: 'integer', description: 'Seconds between world pulses.' },
  { name: 'nextPulseElapsedSeconds', type: 'integer', description: 'Clock elapsedSeconds at which the next pulse becomes due.' },
  { name: 'lastPulseElapsedSeconds', type: 'integer', description: 'Clock elapsedSeconds when the latest pulse was applied.' },
  { name: 'pulseCount', type: 'integer', description: 'Number of applied pulses.' },
  { name: 'randomEventChance', type: 'number', description: 'Chance for a miscellaneous event on each pulse.' },
  { name: 'npcActionChance', type: 'number', description: 'Chance for an NPC autonomous-action event on each pulse.' },
  { name: 'factionActionChance', type: 'number', description: 'Chance for a faction autonomous-action event on each pulse.' },
  { name: 'disasterChance', type: 'number', description: 'Chance for a disaster or major hazard event on each pulse.' },
  { name: 'environmentEventChance', type: 'number', description: 'Chance for a local environmental event on each pulse.' },
  { name: 'maxEventsPerPulse', type: 'integer', description: 'Maximum generated events per pulse.' },
  { name: 'eventTables', type: 'json', description: 'Weighted event tables for npcActions, factionActions, disasters, environmentEvents, and randomEvents.' },
  { name: 'rules', type: 'json', description: 'World-pulse generation rules or GM notes.' },
  { name: 'metadata', type: 'json', description: 'Extra world-clock metadata.' },
  { name: 'source', type: 'text', description: 'manual, agent, import, system, etc.' },
  { name: 'worldClockUpdatedAt', type: 'text', description: 'Latest world-clock update timestamp.' }
];

const DEFAULT_CLOCK_ID = 'active';
const DEFAULT_SETTINGS_ID = 'active';
const DEFAULT_WORLD_CLOCK_ID = 'active';
const DEFAULT_SCENE_ID = 'current';
const DEFAULT_ROUND_SECONDS = 6;
const DEFAULT_WORLD_CLOCK_INTERVAL_SECONDS = 3600;
const ACTIVE_PARTICIPANT_STATUSES = new Set(['active', 'waiting', 'delayed']);

export const DEFAULT_WORLD_EVENT_TABLES = {
  npcActions: [
    {
      id: 'pursue_goal',
      title: 'NPC pursues a personal goal',
      description: 'An important NPC acts offscreen according to their goal, fear, loyalty, or pressure.',
      severity: 'medium',
      weight: 4,
      templateId: 'generic'
    },
    {
      id: 'change_loyalty',
      title: 'NPC loyalty shifts',
      description: 'An NPC reconsiders allegiance, bargains, hesitates, leaks information, or hardens their position.',
      severity: 'high',
      weight: 2,
      templateId: 'faction-pressure'
    },
    {
      id: 'seek_contact',
      title: 'NPC seeks contact',
      description: 'An NPC tries to contact an ally, patron, faction, informant, or player-facing proxy.',
      severity: 'medium',
      weight: 3,
      templateId: 'generic'
    }
  ],
  factionActions: [
    {
      id: 'resource_shift',
      title: 'Faction reallocates resources',
      description: 'A faction moves manpower, money, magic, territory pressure, or attention toward a current priority.',
      severity: 'medium',
      weight: 4
    },
    {
      id: 'covert_move',
      title: 'Faction makes a covert move',
      description: 'A faction launches surveillance, sabotage, propaganda, bribery, or a quiet purge.',
      severity: 'high',
      weight: 2
    },
    {
      id: 'diplomatic_pressure',
      title: 'Faction shifts diplomacy',
      description: 'A faction improves, strains, or tests a relationship with another faction.',
      severity: 'medium',
      weight: 3
    }
  ],
  disasters: [
    {
      id: 'storm',
      title: 'Severe storm',
      description: 'Weather turns dangerous enough to affect travel, visibility, morale, supplies, or structures.',
      severity: 'medium',
      weight: 4
    },
    {
      id: 'earthquake',
      title: 'Earthquake',
      description: 'The ground shakes, damaging routes, buildings, tunnels, or fragile plans.',
      severity: 'high',
      weight: 2
    },
    {
      id: 'volcanic_eruption',
      title: 'Volcanic eruption',
      description: 'A volcano, planar vent, or similar catastrophic source erupts or shows violent warning signs.',
      severity: 'critical',
      weight: 1
    },
    {
      id: 'plague_sign',
      title: 'Disease outbreak sign',
      description: 'Sickness, contamination, curse symptoms, or panic begins to spread.',
      severity: 'high',
      weight: 2
    }
  ],
  environmentEvents: [
    {
      id: 'route_changes',
      title: 'Route conditions change',
      description: 'A road, gate, bridge, dungeon path, patrol route, or magical passage changes availability.',
      severity: 'medium',
      weight: 3
    },
    {
      id: 'resource_pressure',
      title: 'Local resources shift',
      description: 'Food, light, ammunition, shelter, market access, or ritual components become easier or harder to obtain.',
      severity: 'low',
      weight: 4
    }
  ],
  randomEvents: [
    {
      id: 'rumor_spreads',
      title: 'Rumor spreads',
      description: 'A rumor, omen, witness account, or distorted version of recent events spreads.',
      severity: 'low',
      weight: 4
    },
    {
      id: 'opportunity_window',
      title: 'Opportunity window opens',
      description: 'A temporary chance appears: an exposed weakness, absent guard, merchant arrival, or political distraction.',
      severity: 'medium',
      weight: 3
    }
  ]
};

export const DEFAULT_TIME_ADVANCE_RULES = {
  noAdvance: [
    { id: 'ooc_or_rules_question', confidence: 0.9, keywords: ['规则', '怎么', '可以吗', '能不能', '暂停', '存档', '设置'] },
    { id: 'status_question', confidence: 0.85, keywords: ['现在谁', '还有多久', '第几回合', '剩几轮'] }
  ],
  explicitTurnEnd: [
    { id: 'explicit_end_turn', confidence: 0.98, keywords: ['结束回合', '结束我的回合', '回合结束', '结束行动', 'end turn', 'next turn'] }
  ],
  completedTurn: [
    { id: 'move_and_attack', confidence: 0.78, regex: '移动.*攻击|攻击.*移动|走到.*攻击' },
    { id: 'action_then_end', confidence: 0.86, regex: '(攻击|施法|冲刺|撤离|躲避|帮助|准备动作).*结束' },
    { id: 'full_turn_action', confidence: 0.72, keywords: ['冲刺', '撤离', '躲避', '帮助', '准备动作'] }
  ],
  maybeTurnProgress: [
    { id: 'single_action', confidence: 0.55, keywords: ['攻击', '施法', '喝药', '使用道具', '开锁', '解除陷阱'] }
  ],
  timeAdvance: [
    { id: 'quick_action', confidence: 0.65, seconds: 6, keywords: ['推门', '拔剑', '喊话', '捡起', '观察一下'] },
    { id: 'short_exchange', confidence: 0.68, minutes: 1, keywords: ['简单交谈', '问一句', '快速询问'] },
    { id: 'short_conversation', confidence: 0.72, minutes: 5, keywords: ['交谈', '询问情况', '讨价还价'] },
    { id: 'careful_search', confidence: 0.78, minutes: 10, keywords: ['仔细搜索', '彻底搜索', '翻找房间', '检查机关', '排查陷阱'] },
    { id: 'long_conversation', confidence: 0.75, minutes: 30, keywords: ['长谈', '详细询问', '审问', '谈判'] },
    { id: 'short_rest', confidence: 0.95, minutes: 60, keywords: ['短休', '短暂休息'] },
    { id: 'long_rest', confidence: 0.95, hours: 8, keywords: ['长休', '长时间休息', '睡一觉'] }
  ]
};

export class TimeTurnManager {
  constructor({
    appDatabase,
    collections = {},
    trace,
    traceRecorder,
    chatProvider,
    random,
    cwd = process.cwd(),
    now
  } = {}) {
    if (!appDatabase) throw validationError('TimeTurnManager requires appDatabase');
    this.appDatabase = appDatabase;
    this.collections = {
      clocks: collections.clocks || TIME_CLOCKS_COLLECTION,
      encounters: collections.encounters || TIME_ENCOUNTERS_COLLECTION,
      turnOrder: collections.turnOrder || TIME_TURN_ORDER_COLLECTION,
      effects: collections.effects || TIME_EFFECTS_COLLECTION,
      events: collections.events || TIME_EVENTS_COLLECTION,
      interpreterSettings: collections.interpreterSettings || TIME_INTERPRETER_SETTINGS_COLLECTION,
      worldClocks: collections.worldClocks || TIME_WORLD_CLOCKS_COLLECTION
    };
    this.chatProvider = chatProvider;
    this.random = typeof random === 'function' ? random : secureRandom;
    this.now = now || (() => new Date().toISOString());
    this.traceRecorder = traceRecorder || new StructuredInterfaceTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      directory: trace?.directory || 'data/time-traces',
      cwd,
      now: this.now
    });
  }

  ensureCollections(chatSessionId) {
    const database = this.appDatabase.ensureChatDataDatabase(normalizeRequiredText(chatSessionId, 'chatSessionId'));
    const manager = this.appDatabase.openChatDataManagerByChatId(chatSessionId);
    const specs = [
      [this.collections.clocks, TIME_CLOCK_FIELDS, 'time:clock'],
      [this.collections.encounters, TIME_ENCOUNTER_FIELDS, 'time:encounter'],
      [this.collections.turnOrder, TIME_TURN_ORDER_FIELDS, 'time:turn-order'],
      [this.collections.effects, TIME_EFFECT_FIELDS, 'time:effects'],
      [this.collections.events, TIME_EVENT_FIELDS, 'time:events'],
      [this.collections.interpreterSettings, TIME_INTERPRETER_SETTING_FIELDS, 'time:interpreter-settings'],
      [this.collections.worldClocks, TIME_WORLD_CLOCK_FIELDS, 'time:world-clock']
    ];
    const collections = {};
    for (const [collection, fields, reason] of specs) {
      manager.ensureCollection(collection);
      manager.alterFields(collection, { add: fields, reason });
      collections[collection] = manager.describeCollection(collection);
    }
    return { database, collections };
  }

  describe(chatSessionId) {
    return this.ensureCollections(chatSessionId);
  }

  getInterpreterSettings(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(chatSessionId);
    return this.getOrCreateInterpreterSettings(manager, {
      chatSessionId,
      source: input.source || 'system'
    });
  }

  setInterpreterSettings(input = {}) {
    return this.withTrace('time-set-interpreter-settings', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const { manager } = this.openManager(chatSessionId);
      const current = this.getOrCreateInterpreterSettings(manager, { chatSessionId });
      const next = normalizeInterpreterSettings({
        ...current.data,
        ...input,
        rules: input.rules ?? mergeRulePack(DEFAULT_TIME_ADVANCE_RULES, current.data.rules),
        source: input.source || 'manual'
      }, { chatSessionId, now: this.now });
      return {
        settings: manager.upsertRecord(this.collections.interpreterSettings, next, { id: interpreterSettingsId(DEFAULT_SETTINGS_ID) })
      };
    });
  }

  buildAdvanceDecisionPrompt(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const settings = this.getInterpreterSettings({ chatSessionId }).data;
    const clock = this.getClock({ chatSessionId }).data;
    const encounter = safeCall(() => this.resolveEncounter({ chatSessionId, encounterId: input.encounterId }))?.data;
    const turnOrder = encounter
      ? this.listTurnOrder({ chatSessionId, encounterId: encounter.encounterId, includeInactive: false }).records.map((record) => record.data)
      : [];
    return buildTimeAdvanceDecisionPrompt({
      text: input.text || '',
      settings,
      clock,
      encounter,
      turnOrder,
      recentContext: input.recentContext || input.context || '',
      sceneId: input.sceneId
    });
  }

  async interpretAdvance(input = {}, { chatProvider = this.chatProvider } = {}) {
    return this.withTrace('time-interpret-advance', input.chatSessionId, input, async () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const text = normalizeRequiredText(input.text || input.content, 'text');
      const settingsRecord = this.getInterpreterSettings({ chatSessionId });
      const settings = settingsRecord.data;
      const clock = this.getClock({ chatSessionId }).data;
      const encounter = safeCall(() => this.resolveEncounter({ chatSessionId, encounterId: input.encounterId }))?.data;
      const turnOrder = encounter
        ? this.listTurnOrder({ chatSessionId, encounterId: encounter.encounterId, includeInactive: false }).records.map((record) => record.data)
        : [];

      if (!settings.enabled && !input.force) {
        return {
          settings: settingsRecord,
          decision: noAdvanceDecision({
            reason: 'time interpreter is disabled',
            confidence: 1,
            source: 'settings'
          }),
          llm: { used: false, reason: 'disabled' }
        };
      }

      const ruleDecision = interpretAdvanceWithRules(text, {
        settings,
        clock,
        encounter,
        turnOrder,
        sceneId: input.sceneId
      });
      let decision = ruleDecision;
      let llm = { used: false, reason: ruleDecision.matched ? 'rule_matched' : 'llm_disabled' };

      const shouldUseLlm = Boolean(input.useLlm ?? settings.llmEnabled)
        && (!ruleDecision.matched || ruleDecision.needsConfirmation || input.preferLlm);
      if (shouldUseLlm) {
        if (!chatProvider || typeof chatProvider.generate !== 'function') {
          llm = { used: false, reason: 'chatProvider_missing' };
        } else {
          const prompt = buildTimeAdvanceDecisionPrompt({
            text,
            settings,
            clock,
            encounter,
            turnOrder,
            recentContext: input.recentContext || input.context || '',
            sceneId: input.sceneId
          });
          const completion = await chatProvider.generate({
            messages: [
              {
                role: 'system',
                content: 'You convert free-form text RPG actions into conservative time/turn advancement decisions. Return JSON only.'
              },
              { role: 'user', content: prompt }
            ],
            temperature: 0,
            maxTokens: input.maxTokens || 800
          });
          const llmDecision = normalizeAdvanceDecision(parseJsonObject(completion.content), {
            source: 'llm',
            settings,
            clock,
            encounter,
            turnOrder
          });
          const safeLlmDecision = settings.timeEstimationEnabled
            ? llmDecision
            : suppressFuzzyTimeEstimation(llmDecision, ruleDecision);
          llm = {
            used: true,
            content: completion.content,
            raw: completion.raw
          };
          if (!ruleDecision.matched || Number(safeLlmDecision.confidence || 0) >= Number(ruleDecision.confidence || 0)) {
            decision = safeLlmDecision;
          }
        }
      }

      return {
        settings: settingsRecord,
        clock,
        encounter,
        turnOrder,
        ruleDecision,
        decision,
        llm,
        autoApply: false
      };
    });
  }

  listWorldClocks({
    chatSessionId,
    sceneId,
    status,
    enabled,
    filter = {},
    sort = [{ field: 'worldClockUpdatedAt', direction: 'desc' }],
    limit = 100,
    offset = 0
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    const mergedFilter = { ...filter };
    if (sceneId) mergedFilter.sceneId = normalizeSceneId(sceneId);
    if (status) mergedFilter.status = String(status);
    if (enabled !== undefined) mergedFilter.enabled = normalizeBooleanInteger(enabled);
    return {
      ...manager.queryRecords(this.collections.worldClocks, { filter: mergedFilter, sort, limit, offset }),
      chatSessionId: normalizedChatSessionId
    };
  }

  getWorldClock(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(chatSessionId);
    return this.getOrCreateWorldClock(manager, {
      chatSessionId,
      worldClockId: input.worldClockId || input.id,
      sceneId: input.sceneId,
      source: input.source || 'system'
    });
  }

  setWorldClock(input = {}) {
    return this.withTrace('time-set-world-clock', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const { manager } = this.openManager(chatSessionId);
      const clock = this.getOrCreateClock(manager, {
        chatSessionId,
        sceneId: input.sceneId,
        source: input.source || 'manual'
      });
      const worldClockId = normalizeWorldClockId(input.worldClockId || input.id || DEFAULT_WORLD_CLOCK_ID);
      const current = this.getOrCreateWorldClock(manager, {
        chatSessionId,
        worldClockId,
        sceneId: input.sceneId || clock.data.sceneId,
        source: input.source || 'manual'
      });
      const next = normalizeWorldClock({
        ...current.data,
        ...input,
        worldClockId,
        intervalSeconds: input.intervalSeconds ?? input.pulseIntervalSeconds ?? current.data.intervalSeconds,
        nextPulseElapsedSeconds: input.nextPulseElapsedSeconds
          ?? ((input.intervalSeconds !== undefined || input.pulseIntervalSeconds !== undefined)
            ? Number(clock.data.elapsedSeconds || 0) + Number(input.intervalSeconds ?? input.pulseIntervalSeconds)
            : current.data.nextPulseElapsedSeconds),
        eventTables: input.eventTables ?? current.data.eventTables,
        rules: input.rules ?? current.data.rules,
        metadata: input.metadata ?? current.data.metadata,
        source: input.source || 'manual'
      }, {
        chatSessionId,
        clock: clock.data,
        now: this.now
      });
      return {
        clock,
        worldClock: manager.upsertRecord(this.collections.worldClocks, next, { id: worldClockRecordId(worldClockId) })
      };
    });
  }

  buildWorldPulsePrompt(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const clock = this.getClock({ chatSessionId, sceneId: input.sceneId }).data;
    const worldClock = this.getWorldClock({
      chatSessionId,
      worldClockId: input.worldClockId || input.id,
      sceneId: input.sceneId || clock.sceneId
    }).data;
    return buildWorldPulsePrompt({
      clock,
      worldClock,
      sceneId: input.sceneId || clock.sceneId,
      context: normalizeContextValue(input.context),
      contextText: input.contextText || input.recentContext,
      npcRefs: normalizeReferenceArray(input.npcRefs || input.npcs || input.actorRefs || input.actorIds || input.npcIds),
      factionRefs: normalizeReferenceArray(input.factionRefs || input.factions || input.factionIds, { idField: 'factionId' }),
      eventTables: normalizeWorldEventTables(input.eventTables || worldClock.eventTables),
      userRules: input.userRules || input.rulesText || '',
      outputMode: input.outputMode
    });
  }

  async generateWorldPulse(input = {}, { chatProvider = this.chatProvider } = {}) {
    return this.withTrace('time-generate-world-pulse', input.chatSessionId, input, async () => {
      const prepared = this.prepareWorldPulse(input);
      const prompt = buildWorldPulsePrompt({
        clock: prepared.clock.data,
        worldClock: prepared.worldClock.data,
        sceneId: prepared.sceneId,
        context: prepared.context,
        contextText: input.contextText || input.recentContext,
        npcRefs: prepared.npcRefs,
        factionRefs: prepared.factionRefs,
        eventTables: prepared.eventTables,
        userRules: input.userRules || input.rulesText || '',
        outputMode: input.outputMode
      });
      if (!prepared.dueInfo.due) {
        return {
          clock: prepared.clock,
          worldClock: prepared.worldClock,
          due: false,
          dueInfo: prepared.dueInfo,
          pulse: emptyWorldPulse(prepared, { prompt }),
          llm: { used: false, reason: 'not_due' }
        };
      }

      const basePulse = createWorldPulse({
        ...prepared,
        random: this.random,
        now: this.now,
        input
      });
      const llm = await maybeGenerateLlmWorldPulse({
        input,
        chatProvider,
        prompt,
        prepared,
        basePulse
      });
      const pulse = llm.events ? {
        ...basePulse,
        events: llm.events,
        proposedToolCalls: llm.events.flatMap((event) => event.proposedToolCalls || []),
        source: 'llm'
      } : basePulse;
      return {
        clock: prepared.clock,
        worldClock: prepared.worldClock,
        due: true,
        dueInfo: prepared.dueInfo,
        pulse: {
          ...pulse,
          prompt
        },
        llm
      };
    });
  }

  async runWorldPulse(input = {}, { chatProvider = this.chatProvider } = {}) {
    return this.withTrace('time-run-world-pulse', input.chatSessionId, input, async () => {
      const dryRun = input.dryRun !== false;
      const prepared = this.prepareWorldPulse(input);
      const prompt = buildWorldPulsePrompt({
        clock: prepared.clock.data,
        worldClock: prepared.worldClock.data,
        sceneId: prepared.sceneId,
        context: prepared.context,
        contextText: input.contextText || input.recentContext,
        npcRefs: prepared.npcRefs,
        factionRefs: prepared.factionRefs,
        eventTables: prepared.eventTables,
        userRules: input.userRules || input.rulesText || '',
        outputMode: input.outputMode
      });
      if (!prepared.dueInfo.due) {
        return {
          dryRun,
          clock: prepared.clock,
          worldClock: prepared.worldClock,
          due: false,
          dueInfo: prepared.dueInfo,
          pulse: emptyWorldPulse(prepared, { prompt }),
          scheduledEvents: [],
          llm: { used: false, reason: 'not_due' }
        };
      }

      const basePulse = createWorldPulse({
        ...prepared,
        random: this.random,
        now: this.now,
        input
      });
      const llm = await maybeGenerateLlmWorldPulse({
        input,
        chatProvider,
        prompt,
        prepared,
        basePulse
      });
      const pulse = llm.events ? {
        ...basePulse,
        events: llm.events,
        proposedToolCalls: llm.events.flatMap((event) => event.proposedToolCalls || []),
        source: 'llm'
      } : basePulse;

      if (dryRun) {
        return {
          dryRun,
          clock: prepared.clock,
          worldClock: prepared.worldClock,
          due: true,
          dueInfo: prepared.dueInfo,
          pulse: {
            ...pulse,
            prompt
          },
          scheduledEvents: [],
          llm
        };
      }

      const scheduledEvents = pulse.events.map((event) => {
        const scheduleInput = {
          ...event.scheduleEvent,
          chatSessionId: prepared.chatSessionId,
          sceneId: event.sceneId || prepared.sceneId,
          status: event.scheduleEvent?.status || 'due',
          source: event.scheduleEvent?.source || 'world-clock'
        };
        const normalized = normalizeScheduledEvent(scheduleInput, {
          chatSessionId: prepared.chatSessionId,
          clock: prepared.clock.data,
          now: this.now
        });
        return prepared.manager.upsertRecord(this.collections.events, normalized, { id: normalized.eventId });
      });
      const advancedWorldClock = prepared.manager.upsertRecord(
        this.collections.worldClocks,
        advanceWorldClockAfterPulse(prepared.worldClock.data, {
          clock: prepared.clock.data,
          now: this.now
        }),
        { id: prepared.worldClock.id }
      );
      return {
        dryRun,
        clock: prepared.clock,
        worldClock: advancedWorldClock,
        due: true,
        dueInfo: prepared.dueInfo,
        pulse: {
          ...pulse,
          prompt
        },
        scheduledEvents,
        llm
      };
    });
  }

  getClock(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(chatSessionId);
    return this.getOrCreateClock(manager, {
      chatSessionId,
      sceneId: input.sceneId,
      source: input.source || 'system'
    });
  }

  advanceTime(input = {}) {
    return this.withTrace('time-advance', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const deltaSeconds = normalizeDurationSeconds(input);
      if (deltaSeconds <= 0) throw validationError('advance_time requires a positive duration');
      const { manager } = this.openManager(chatSessionId);
      const clock = this.getOrCreateClock(manager, { chatSessionId, sceneId: input.sceneId, source: input.source || 'agent' });
      const timestamp = this.now();
      const next = normalizeClock({
        ...clock.data,
        sceneId: input.sceneId || clock.data.sceneId,
        phase: input.phase || input.mode || clock.data.phase || 'narrative',
        elapsedSeconds: Number(clock.data.elapsedSeconds || 0) + deltaSeconds,
        source: input.source || 'agent',
        clockUpdatedAt: timestamp
      }, { chatSessionId, now: this.now });
      const record = manager.upsertRecord(this.collections.clocks, next, { id: clock.id });
      const dueEvents = this.findDueEvents({ chatSessionId, clock: record.data });
      const dueWorldClocks = this.findDueWorldClocks({ chatSessionId, clock: record.data });
      return {
        clock: record,
        deltaSeconds,
        dueEvents,
        dueWorldClocks
      };
    });
  }

  startEncounter(input = {}) {
    return this.withTrace('time-start-encounter', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const { manager } = this.openManager(chatSessionId);
      const clock = this.getOrCreateClock(manager, { chatSessionId, sceneId: input.sceneId, source: input.source || 'agent' });
      const timestamp = this.now();
      const sceneId = normalizeSceneId(input.sceneId || clock.data.sceneId);
      const encounterId = normalizeEncounterId(input.encounterId || input.id || input.name || `${sceneId}_${timestamp}`);
      const roundDurationSeconds = normalizePositiveInteger(input.roundDurationSeconds ?? clock.data.roundDurationSeconds ?? DEFAULT_ROUND_SECONDS, 'roundDurationSeconds');
      const participants = normalizeParticipants(input.participants || [], {
        chatSessionId,
        encounterId,
        sceneId,
        now: this.now
      });
      const sorted = sortTurnRecords(participants);
      const participantIds = sorted.map((participant) => participant.participantId);
      const current = sorted[0];
      const encounter = manager.upsertRecord(this.collections.encounters, {
        chatSessionId,
        encounterId,
        sceneId,
        name: normalizeOptionalText(input.name) || encounterId,
        mode: normalizeOptionalText(input.mode) || 'combat',
        status: normalizeOptionalText(input.status) || 'active',
        roundNumber: normalizeNonNegativeInteger(input.roundNumber ?? 1, 'roundNumber'),
        turnIndex: current ? 0 : -1,
        currentParticipantId: current?.participantId || '',
        roundDurationSeconds,
        participantIds,
        metadata: normalizeObject(input.metadata),
        startedAt: timestamp,
        endedAt: '',
        encounterUpdatedAt: timestamp
      }, { id: encounterId });

      sorted.forEach((participant, index) => {
        manager.upsertRecord(this.collections.turnOrder, {
          ...participant,
          orderIndex: index,
          hasActed: 0,
          actionState: defaultActionState(participant.actionState),
          turnStartedAt: index === 0 ? timestamp : '',
          turnUpdatedAt: timestamp
        }, { id: turnOrderId(encounterId, participant.participantId) });
      });

      const updatedClock = manager.upsertRecord(this.collections.clocks, {
        ...clock.data,
        sceneId,
        phase: 'round',
        activeEncounterId: encounterId,
        roundNumber: encounter.data.roundNumber,
        turnNumber: Number(clock.data.turnNumber || 0),
        roundDurationSeconds,
        source: input.source || 'agent',
        clockUpdatedAt: timestamp
      }, { id: clock.id });

      return {
        clock: updatedClock,
        encounter,
        turnOrder: this.listTurnOrder({ chatSessionId, encounterId }).records
      };
    });
  }

  endEncounter(input = {}) {
    return this.withTrace('time-end-encounter', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const { manager } = this.openManager(chatSessionId);
      const clock = this.getOrCreateClock(manager, { chatSessionId });
      const encounter = this.resolveEncounter({ chatSessionId, encounterId: input.encounterId });
      const timestamp = this.now();
      const updatedEncounter = manager.patchRecord(this.collections.encounters, encounter.id, {
        status: input.status || 'ended',
        endedAt: timestamp,
        encounterUpdatedAt: timestamp
      });
      const updatedClock = manager.upsertRecord(this.collections.clocks, {
        ...clock.data,
        phase: input.phase || 'narrative',
        activeEncounterId: clock.data.activeEncounterId === encounter.data.encounterId ? '' : clock.data.activeEncounterId,
        source: input.source || 'agent',
        clockUpdatedAt: timestamp
      }, { id: clock.id });
      return {
        clock: updatedClock,
        encounter: updatedEncounter
      };
    });
  }

  getEncounter(input = {}) {
    return this.resolveEncounter(input);
  }

  listEncounters({
    chatSessionId,
    sceneId,
    status,
    query = '',
    filter = {},
    sort = [{ field: 'encounterUpdatedAt', direction: 'desc' }],
    limit = 100,
    offset = 0
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    const mergedFilter = { ...filter };
    if (sceneId) mergedFilter.sceneId = normalizeSceneId(sceneId);
    if (status) mergedFilter.status = String(status);
    const result = manager.queryRecords(this.collections.encounters, { filter: mergedFilter, sort, limit, offset });
    const normalizedQuery = normalizeSearchText(query);
    const records = result.records.filter((record) => {
      if (!normalizedQuery) return true;
      const data = record.data || {};
      return normalizeSearchText([
        record.id,
        data.encounterId,
        data.name,
        data.mode,
        data.sceneId,
        data.status
      ].filter(Boolean).join(' ')).includes(normalizedQuery);
    });
    return {
      ...result,
      chatSessionId: normalizedChatSessionId,
      records
    };
  }

  listTurnOrder({
    chatSessionId,
    encounterId,
    includeInactive = false,
    status,
    limit = 500,
    offset = 0
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const encounter = encounterId ? undefined : this.resolveEncounter({ chatSessionId: normalizedChatSessionId });
    const resolvedEncounterId = normalizeOptionalText(encounterId) || encounter.data.encounterId;
    const { manager } = this.openManager(normalizedChatSessionId);
    const filter = { encounterId: resolvedEncounterId };
    if (status) filter.status = String(status);
    const result = manager.queryRecords(this.collections.turnOrder, {
      filter,
      sort: [{ field: 'orderIndex', direction: 'asc' }, { field: 'initiative', direction: 'desc' }],
      limit,
      offset
    });
    const records = result.records.filter((record) => {
      if (includeInactive) return true;
      return ACTIVE_PARTICIPANT_STATUSES.has(String(record.data.status || 'active'));
    });
    return {
      ...result,
      chatSessionId: normalizedChatSessionId,
      encounterId: resolvedEncounterId,
      records
    };
  }

  addParticipant(input = {}) {
    return this.withTrace('time-add-participant', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const encounter = this.resolveEncounter({ chatSessionId, encounterId: input.encounterId });
      const { manager } = this.openManager(chatSessionId);
      const participant = normalizeParticipant(input, {
        chatSessionId,
        encounterId: encounter.data.encounterId,
        sceneId: encounter.data.sceneId,
        index: Number.MAX_SAFE_INTEGER,
        now: this.now
      });
      const record = manager.upsertRecord(this.collections.turnOrder, participant, {
        id: turnOrderId(encounter.data.encounterId, participant.participantId)
      });
      const reordered = this.reorderTurnOrder({ chatSessionId, encounterId: encounter.data.encounterId });
      return {
        participant: record,
        encounter: reordered.encounter,
        turnOrder: reordered.turnOrder
      };
    });
  }

  removeParticipant(input = {}) {
    return this.withTrace('time-remove-participant', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const mode = String(input.mode || 'markRemoved');
      const encounter = this.resolveEncounter({ chatSessionId, encounterId: input.encounterId });
      const participantId = normalizeParticipantId(input.participantId || input.actorId || input.npcId || input.id);
      const { manager } = this.openManager(chatSessionId);
      const recordId = turnOrderId(encounter.data.encounterId, participantId);
      const result = mode === 'delete'
        ? manager.deleteRecord(this.collections.turnOrder, recordId)
        : manager.patchRecord(this.collections.turnOrder, recordId, {
          status: mode === 'defeat' ? 'defeated' : 'removed',
          turnUpdatedAt: this.now()
        });
      const reordered = this.reorderTurnOrder({ chatSessionId, encounterId: encounter.data.encounterId });
      return {
        participant: result,
        encounter: reordered.encounter,
        turnOrder: reordered.turnOrder
      };
    });
  }

  setInitiative(input = {}) {
    return this.withTrace('time-set-initiative', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const encounter = this.resolveEncounter({ chatSessionId, encounterId: input.encounterId });
      const participantId = normalizeParticipantId(input.participantId || input.actorId || input.npcId || input.id);
      const { manager } = this.openManager(chatSessionId);
      const recordId = turnOrderId(encounter.data.encounterId, participantId);
      const participant = manager.patchRecord(this.collections.turnOrder, recordId, {
        initiative: normalizeNumber(input.initiative, 'initiative'),
        initiativeRoll: input.initiativeRoll || {},
        dexterityModifier: normalizeInteger(input.dexterityModifier ?? manager.getRecord(this.collections.turnOrder, recordId).data.dexterityModifier ?? 0, 'dexterityModifier'),
        turnUpdatedAt: this.now()
      });
      const reordered = this.reorderTurnOrder({ chatSessionId, encounterId: encounter.data.encounterId });
      return {
        participant,
        encounter: reordered.encounter,
        turnOrder: reordered.turnOrder
      };
    });
  }

  rollInitiative(input = {}) {
    return this.withTrace('time-roll-initiative', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const encounter = this.resolveEncounter({ chatSessionId, encounterId: input.encounterId });
      const listed = this.listTurnOrder({
        chatSessionId,
        encounterId: encounter.data.encounterId,
        includeInactive: Boolean(input.includeInactive)
      });
      const participantFilter = new Set(normalizeStringArray(input.participantIds || input.participantId || input.actorId || input.npcId));
      const { manager } = this.openManager(chatSessionId);
      const rolls = [];
      for (const record of listed.records) {
        const data = record.data || {};
        if (participantFilter.size > 0 && !participantFilter.has(data.participantId)) continue;
        const roll = runDiceCheck({
          successThreshold: -100000,
          diceCount: 1,
          diceSides: 20,
          modifier: normalizeInteger(input.modifier ?? 0, 'modifier'),
          abilityModifier: normalizeInteger(input.dexterityModifier ?? data.dexterityModifier ?? 0, 'dexterityModifier'),
          modifiers: input.modifiers || [],
          rollMode: input.rollMode || 'normal',
          criticalMode: 'none'
        });
        const updated = manager.patchRecord(this.collections.turnOrder, record.id, {
          initiative: roll.total,
          initiativeRoll: roll,
          turnUpdatedAt: this.now()
        });
        rolls.push(updated);
      }
      const reordered = this.reorderTurnOrder({ chatSessionId, encounterId: encounter.data.encounterId });
      return {
        rolls,
        encounter: reordered.encounter,
        turnOrder: reordered.turnOrder
      };
    });
  }

  nextTurn(input = {}) {
    return this.withTrace('time-next-turn', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const { manager } = this.openManager(chatSessionId);
      const clock = this.getOrCreateClock(manager, { chatSessionId });
      const encounter = this.resolveEncounter({ chatSessionId, encounterId: input.encounterId });
      if (encounter.data.status !== 'active') throw validationError(`Encounter is not active: ${encounter.data.encounterId}`);

      const order = this.listTurnOrder({
        chatSessionId,
        encounterId: encounter.data.encounterId,
        includeInactive: false
      }).records;
      if (order.length === 0) throw validationError('Cannot advance turn without active participants');

      const timestamp = this.now();
      const currentIndex = normalizeTurnIndex(encounter.data.turnIndex, encounter.data.currentParticipantId, order);
      const current = order[currentIndex] || order[0];
      manager.patchRecord(this.collections.turnOrder, current.id, {
        hasActed: 1,
        actionState: endActionState(current.data.actionState),
        turnUpdatedAt: timestamp
      });

      let nextIndex = currentIndex + 1;
      let roundNumber = Number(encounter.data.roundNumber || 1);
      let roundAdvanced = false;
      if (nextIndex >= order.length) {
        nextIndex = 0;
        roundNumber += 1;
        roundAdvanced = true;
        for (const participant of order) {
          manager.patchRecord(this.collections.turnOrder, participant.id, {
            hasActed: 0,
            actionState: defaultActionState(participant.data.actionState),
            turnUpdatedAt: timestamp
          });
        }
      }

      const next = order[nextIndex];
      manager.patchRecord(this.collections.turnOrder, next.id, {
        hasActed: 0,
        actionState: defaultActionState(next.data.actionState),
        turnStartedAt: timestamp,
        turnUpdatedAt: timestamp
      });

      const tickedEffects = [
        ...this.tickEffects({
          manager,
          chatSessionId,
          encounterId: encounter.data.encounterId,
          timing: 'endTurn',
          participantId: current.data.participantId
        }),
        ...(roundAdvanced ? this.tickEffects({
          manager,
          chatSessionId,
          encounterId: encounter.data.encounterId,
          timing: 'endRound'
        }) : []),
        ...this.tickEffects({
          manager,
          chatSessionId,
          encounterId: encounter.data.encounterId,
          timing: 'startTurn',
          participantId: next.data.participantId
        })
      ];

      const updatedEncounter = manager.patchRecord(this.collections.encounters, encounter.id, {
        roundNumber,
        turnIndex: nextIndex,
        currentParticipantId: next.data.participantId,
        encounterUpdatedAt: timestamp
      });
      const updatedClock = manager.upsertRecord(this.collections.clocks, {
        ...clock.data,
        sceneId: encounter.data.sceneId,
        phase: 'turn',
        activeEncounterId: encounter.data.encounterId,
        roundNumber,
        turnNumber: Number(clock.data.turnNumber || 0) + 1,
        elapsedSeconds: Number(clock.data.elapsedSeconds || 0) + (roundAdvanced ? Number(encounter.data.roundDurationSeconds || DEFAULT_ROUND_SECONDS) : 0),
        source: input.source || 'agent',
        clockUpdatedAt: timestamp
      }, { id: clock.id });
      const dueEvents = this.findDueEvents({ chatSessionId, clock: updatedClock.data, encounter: updatedEncounter.data });
      const dueWorldClocks = this.findDueWorldClocks({ chatSessionId, clock: updatedClock.data });
      return {
        clock: updatedClock,
        encounter: updatedEncounter,
        previousParticipantId: current.data.participantId,
        currentParticipantId: next.data.participantId,
        roundAdvanced,
        tickedEffects,
        dueEvents,
        dueWorldClocks,
        turnOrder: this.listTurnOrder({ chatSessionId, encounterId: encounter.data.encounterId, includeInactive: true }).records
      };
    });
  }

  endTurn(input = {}) {
    return this.nextTurn(input);
  }

  addEffect(input = {}) {
    return this.withTrace('time-add-effect', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const { manager } = this.openManager(chatSessionId);
      const encounter = input.encounterId ? this.resolveEncounter({ chatSessionId, encounterId: input.encounterId }) : undefined;
      const effect = normalizeEffect(input, {
        chatSessionId,
        encounterId: encounter?.data.encounterId || input.encounterId || '',
        sceneId: input.sceneId || encounter?.data.sceneId,
        now: this.now
      });
      return manager.upsertRecord(this.collections.effects, effect, { id: effect.effectId });
    });
  }

  patchEffect(input = {}) {
    return this.withTrace('time-patch-effect', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const effectId = normalizeEffectId(input.effectId || input.id);
      const { manager } = this.openManager(chatSessionId);
      const current = manager.getRecord(this.collections.effects, effectId);
      const effect = normalizeEffect({
        ...current.data,
        ...(input.patch || {}),
        effectId
      }, {
        chatSessionId,
        encounterId: current.data.encounterId,
        sceneId: current.data.sceneId,
        now: this.now,
        existing: current.data
      });
      return manager.upsertRecord(this.collections.effects, effect, { id: effectId });
    });
  }

  removeEffect(input = {}) {
    return this.withTrace('time-remove-effect', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const effectId = normalizeEffectId(input.effectId || input.id);
      const { manager } = this.openManager(chatSessionId);
      if (input.mode === 'delete') return manager.deleteRecord(this.collections.effects, effectId);
      return manager.patchRecord(this.collections.effects, effectId, {
        status: input.status || 'removed',
        effectUpdatedAt: this.now()
      });
    });
  }

  listEffects({
    chatSessionId,
    encounterId,
    sceneId,
    targetParticipantId,
    ownerParticipantId,
    status,
    includeInactive = false,
    limit = 500,
    offset = 0
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    const filter = {};
    if (encounterId) filter.encounterId = normalizeEncounterId(encounterId);
    if (sceneId) filter.sceneId = normalizeSceneId(sceneId);
    if (targetParticipantId) filter.targetParticipantId = normalizeParticipantId(targetParticipantId);
    if (ownerParticipantId) filter.ownerParticipantId = normalizeParticipantId(ownerParticipantId);
    if (status) filter.status = String(status);
    const result = manager.queryRecords(this.collections.effects, {
      filter,
      sort: [{ field: 'effectUpdatedAt', direction: 'desc' }],
      limit,
      offset
    });
    const records = result.records.filter((record) => {
      if (includeInactive) return true;
      return !['expired', 'removed'].includes(String(record.data.status || '').toLowerCase());
    });
    return {
      ...result,
      chatSessionId: normalizedChatSessionId,
      records
    };
  }

  scheduleEvent(input = {}) {
    return this.withTrace('time-schedule-event', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const { manager } = this.openManager(chatSessionId);
      const clock = this.getOrCreateClock(manager, { chatSessionId, sceneId: input.sceneId });
      const encounter = input.encounterId || clock.data.activeEncounterId
        ? this.resolveEncounter({ chatSessionId, encounterId: input.encounterId || clock.data.activeEncounterId })
        : undefined;
      const event = normalizeScheduledEvent(input, {
        chatSessionId,
        clock: clock.data,
        encounter: encounter?.data,
        now: this.now
      });
      return manager.upsertRecord(this.collections.events, event, { id: event.eventId });
    });
  }

  resolveDueEvents(input = {}) {
    return this.withTrace('time-resolve-due-events', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const { manager } = this.openManager(chatSessionId);
      const clock = this.getOrCreateClock(manager, { chatSessionId });
      const encounter = clock.data.activeEncounterId
        ? this.resolveEncounter({ chatSessionId, encounterId: clock.data.activeEncounterId })
        : undefined;
      const due = this.findDueEvents({ chatSessionId, clock: clock.data, encounter: encounter?.data, includeDue: Boolean(input.includeDue) });
      const status = input.markResolved ? 'resolved' : (input.status || 'due');
      const timestamp = this.now();
      const records = due.map((event) => manager.patchRecord(this.collections.events, event.id, {
        status,
        resolvedAt: status === 'resolved' ? timestamp : event.data.resolvedAt,
        eventUpdatedAt: timestamp
      }));
      return {
        count: records.length,
        status,
        events: records
      };
    });
  }

  listEvents({
    chatSessionId,
    encounterId,
    sceneId,
    status,
    includeResolved = false,
    limit = 500,
    offset = 0
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    const filter = {};
    if (encounterId) filter.encounterId = normalizeEncounterId(encounterId);
    if (sceneId) filter.sceneId = normalizeSceneId(sceneId);
    if (status) filter.status = String(status);
    const result = manager.queryRecords(this.collections.events, {
      filter,
      sort: [{ field: 'dueElapsedSeconds', direction: 'asc' }, { field: 'dueRound', direction: 'asc' }],
      limit,
      offset
    });
    const records = result.records.filter((record) => includeResolved || !['resolved', 'cancelled'].includes(String(record.data.status || '').toLowerCase()));
    return {
      ...result,
      chatSessionId: normalizedChatSessionId,
      records
    };
  }

  exportTimeline({
    chatSessionId,
    format = 'json',
    includeResolved = true
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const snapshot = this.timelineSnapshot({ chatSessionId: normalizedChatSessionId, includeResolved });
    const normalizedFormat = String(format || 'json').toLowerCase();
    if (normalizedFormat === 'json') {
      return {
        format: 'json',
        text: `${JSON.stringify(snapshot, null, 2)}\n`,
        payload: snapshot
      };
    }
    if (normalizedFormat === 'yaml' || normalizedFormat === 'yml') {
      return {
        format: 'yaml',
        text: YAML.stringify(snapshot),
        payload: snapshot
      };
    }
    throw validationError('export format must be json or yaml');
  }

  importTimeline(input = {}) {
    return this.withTrace('time-import-timeline', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const { manager } = this.openManager(chatSessionId);
      const parsed = parseStructuredDocument(input);
      const data = parsed.data?.timeTimeline || parsed.data?.timeline || parsed.data || {};
      const groups = documentToCollections({
        data,
        collection: input.collection,
        collectionMap: {
          clocks: this.collections.clocks,
          timeClocks: this.collections.clocks,
          encounters: this.collections.encounters,
          timeEncounters: this.collections.encounters,
          turnOrder: this.collections.turnOrder,
          timeTurnOrder: this.collections.turnOrder,
          effects: this.collections.effects,
          timeEffects: this.collections.effects,
          events: this.collections.events,
          timeEvents: this.collections.events,
          interpreterSettings: this.collections.interpreterSettings,
          timeInterpreterSettings: this.collections.interpreterSettings,
          worldClocks: this.collections.worldClocks,
          timeWorldClocks: this.collections.worldClocks,
          ...(input.collectionMap || {})
        },
        idField: input.idField || 'id'
      });
      const records = [];
      const directGroups = [
        { collection: this.collections.clocks, records: normalizeImportRecords(data.clock ? [data.clock] : data.clocks) },
        { collection: this.collections.encounters, records: normalizeImportRecords(data.encounters) },
        { collection: this.collections.turnOrder, records: normalizeImportRecords(data.turnOrder) },
        { collection: this.collections.effects, records: normalizeImportRecords(data.effects) },
        { collection: this.collections.events, records: normalizeImportRecords(data.events) },
        { collection: this.collections.interpreterSettings, records: normalizeImportRecords(data.interpreterSettings) },
        { collection: this.collections.worldClocks, records: normalizeImportRecords(data.worldClocks) }
      ];
      const hasTimelineShape = ['clock', 'clocks', 'encounters', 'turnOrder', 'effects', 'events', 'interpreterSettings', 'worldClocks']
        .some((field) => data[field] !== undefined);
      const mergedGroups = (hasTimelineShape ? directGroups : groups).filter((group) => group.records?.length);
      for (const group of mergedGroups) {
        for (const rawRecord of group.records) {
          const { id, ...record } = rawRecord;
          const normalized = {
            ...record,
            chatSessionId: record.chatSessionId || chatSessionId
          };
          const recordId = id
            || normalized.clockId && clockRecordId(normalized.clockId)
            || normalized.encounterId
            || normalized.participantId && normalized.encounterId && turnOrderId(normalized.encounterId, normalized.participantId)
            || normalized.effectId
            || normalized.eventId
            || normalized.settingsId && interpreterSettingsId(normalized.settingsId)
            || normalized.worldClockId && worldClockRecordId(normalized.worldClockId);
          records.push(manager.upsertRecord(group.collection, normalized, { id: recordId }));
        }
      }
      return {
        format: parsed.format,
        count: records.length,
        records
      };
    });
  }

  timelineSnapshot({ chatSessionId, includeResolved = true } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    const clock = manager.getRecord(this.collections.clocks, clockRecordId(DEFAULT_CLOCK_ID), { missing: 'undefined' });
    const encounters = manager.queryRecords(this.collections.encounters, { limit: 500 }).records;
    const turnOrder = manager.queryRecords(this.collections.turnOrder, {
      sort: [{ field: 'encounterId', direction: 'asc' }, { field: 'orderIndex', direction: 'asc' }],
      limit: 500
    }).records;
    const effects = manager.queryRecords(this.collections.effects, { limit: 500 }).records;
    const events = manager.queryRecords(this.collections.events, { limit: 500 }).records
      .filter((record) => includeResolved || !['resolved', 'cancelled'].includes(String(record.data.status || '').toLowerCase()));
    const interpreterSettings = manager.getRecord(this.collections.interpreterSettings, interpreterSettingsId(DEFAULT_SETTINGS_ID), { missing: 'undefined' });
    const worldClocks = manager.queryRecords(this.collections.worldClocks, { limit: 500 }).records;
    return {
      chatSessionId: normalizedChatSessionId,
      clock: clock ? { id: clock.id, ...clock.data } : undefined,
      encounters: encounters.map((record) => ({ id: record.id, ...record.data })),
      turnOrder: turnOrder.map((record) => ({ id: record.id, ...record.data })),
      effects: effects.map((record) => ({ id: record.id, ...record.data })),
      events: events.map((record) => ({ id: record.id, ...record.data })),
      interpreterSettings: interpreterSettings ? { id: interpreterSettings.id, ...interpreterSettings.data } : undefined,
      worldClocks: worldClocks.map((record) => ({ id: record.id, ...record.data }))
    };
  }

  findDueEvents({ chatSessionId, clock, encounter, includeDue = false } = {}) {
    const listed = this.listEvents({
      chatSessionId,
      includeResolved: false,
      limit: 500
    }).records;
    return listed.filter((record) => {
      const data = record.data || {};
      if (data.status === 'due' && includeDue) return true;
      if (data.status !== 'scheduled') return false;
      if (data.dueElapsedSeconds !== undefined && data.dueElapsedSeconds !== null && data.dueElapsedSeconds !== '') {
        if (Number(data.dueElapsedSeconds) <= Number(clock?.elapsedSeconds || 0)) return true;
      }
      if (data.dueRound !== undefined && data.dueRound !== null && data.dueRound !== '') {
        const activeEncounterMatches = !data.encounterId || !encounter?.encounterId || data.encounterId === encounter.encounterId;
        const roundReached = Number(data.dueRound) < Number(encounter?.roundNumber || clock?.roundNumber || 0)
          || (Number(data.dueRound) === Number(encounter?.roundNumber || clock?.roundNumber || 0)
            && (data.dueTurnIndex === undefined || data.dueTurnIndex === null || data.dueTurnIndex === '' || Number(data.dueTurnIndex) <= Number(encounter?.turnIndex || 0)));
        if (activeEncounterMatches && roundReached) return true;
      }
      return false;
    });
  }

  findDueWorldClocks({ chatSessionId, clock, includePaused = false } = {}) {
    const listed = this.listWorldClocks({
      chatSessionId,
      limit: 500
    }).records;
    return listed
      .map((record) => ({
        ...record,
        dueInfo: worldClockDueInfo(record.data, clock)
      }))
      .filter((record) => {
        if (!includePaused && !worldClockCanPulse(record.data)) return false;
        return record.dueInfo.due;
      });
  }

  prepareWorldPulse(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(chatSessionId);
    const clock = this.getOrCreateClock(manager, {
      chatSessionId,
      sceneId: input.sceneId,
      source: input.source || 'system'
    });
    const worldClock = this.getOrCreateWorldClock(manager, {
      chatSessionId,
      worldClockId: input.worldClockId || input.id,
      sceneId: input.sceneId || clock.data.sceneId,
      source: input.source || 'system'
    });
    const sceneId = normalizeSceneId(input.sceneId || worldClock.data.sceneId || clock.data.sceneId);
    const dueInfo = worldClockDueInfo(worldClock.data, clock.data, Boolean(input.force));
    const eventTables = normalizeWorldEventTables(input.eventTables || worldClock.data.eventTables);
    return {
      manager,
      chatSessionId,
      clock,
      worldClock,
      sceneId,
      dueInfo,
      eventTables,
      context: normalizeContextValue(input.context),
      npcRefs: normalizeReferenceArray(input.npcRefs || input.npcs || input.actorRefs || input.actorIds || input.npcIds),
      factionRefs: normalizeReferenceArray(input.factionRefs || input.factions || input.factionIds, { idField: 'factionId' }),
      maxEventsPerPulse: normalizePositiveInteger(input.maxEventsPerPulse ?? worldClock.data.maxEventsPerPulse ?? 4, 'maxEventsPerPulse'),
      chances: {
        npcActionChance: normalizeProbability(input.npcActionChance ?? worldClock.data.npcActionChance ?? 0.35, 'npcActionChance'),
        factionActionChance: normalizeProbability(input.factionActionChance ?? worldClock.data.factionActionChance ?? 0.3, 'factionActionChance'),
        disasterChance: normalizeProbability(input.disasterChance ?? worldClock.data.disasterChance ?? 0.05, 'disasterChance'),
        environmentEventChance: normalizeProbability(input.environmentEventChance ?? worldClock.data.environmentEventChance ?? 0.2, 'environmentEventChance'),
        randomEventChance: normalizeProbability(input.randomEventChance ?? worldClock.data.randomEventChance ?? 0.25, 'randomEventChance')
      }
    };
  }

  tickEffects({ manager, chatSessionId, encounterId, timing, participantId } = {}) {
    const records = this.listEffects({
      chatSessionId,
      encounterId,
      includeInactive: false,
      limit: 500
    }).records;
    const timestamp = this.now();
    const updates = [];
    for (const record of records) {
      const data = record.data || {};
      if (data.durationType !== 'rounds') continue;
      if (!effectShouldTick(data, timing, participantId)) continue;
      const current = Number(data.remainingRounds ?? 0);
      if (!Number.isFinite(current) || current <= 0) continue;
      const next = current - 1;
      updates.push(manager.patchRecord(this.collections.effects, record.id, {
        remainingRounds: next,
        status: next <= 0 ? 'expired' : data.status,
        effectUpdatedAt: timestamp
      }));
    }
    return updates;
  }

  reorderTurnOrder({ chatSessionId, encounterId } = {}) {
    const { manager } = this.openManager(chatSessionId);
    const encounter = this.resolveEncounter({ chatSessionId, encounterId });
    const all = manager.queryRecords(this.collections.turnOrder, {
      filter: { encounterId: encounter.data.encounterId },
      limit: 500
    }).records;
    const sorted = sortTurnRecords(all.map((record) => ({ ...record.data, id: record.id })));
    const timestamp = this.now();
    const records = sorted.map((participant, index) => manager.upsertRecord(this.collections.turnOrder, {
      ...participant,
      orderIndex: index,
      turnUpdatedAt: timestamp
    }, { id: participant.id || turnOrderId(encounter.data.encounterId, participant.participantId) }));
    const active = records.filter((record) => ACTIVE_PARTICIPANT_STATUSES.has(String(record.data.status || 'active')));
    const currentParticipantId = active.some((record) => record.data.participantId === encounter.data.currentParticipantId)
      ? encounter.data.currentParticipantId
      : (active[0]?.data.participantId || '');
    const turnIndex = Math.max(0, active.findIndex((record) => record.data.participantId === currentParticipantId));
    const updatedEncounter = manager.patchRecord(this.collections.encounters, encounter.id, {
      participantIds: active.map((record) => record.data.participantId),
      currentParticipantId,
      turnIndex,
      encounterUpdatedAt: timestamp
    });
    return {
      encounter: updatedEncounter,
      turnOrder: this.listTurnOrder({ chatSessionId, encounterId: encounter.data.encounterId, includeInactive: true }).records
    };
  }

  resolveEncounter({ chatSessionId, encounterId } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    const clock = this.getOrCreateClock(manager, { chatSessionId: normalizedChatSessionId });
    const resolvedId = normalizeOptionalText(encounterId) || normalizeOptionalText(clock.data.activeEncounterId);
    if (resolvedId) return manager.getRecord(this.collections.encounters, normalizeEncounterId(resolvedId));
    const active = manager.queryRecords(this.collections.encounters, {
      filter: { status: 'active' },
      sort: [{ field: 'encounterUpdatedAt', direction: 'desc' }],
      limit: 1
    }).records[0];
    if (!active) throw notFound('No active encounter found');
    return active;
  }

  getOrCreateClock(manager, { chatSessionId, sceneId = DEFAULT_SCENE_ID, source = 'system' } = {}) {
    const id = clockRecordId(DEFAULT_CLOCK_ID);
    const existing = manager.getRecord(this.collections.clocks, id, { missing: 'undefined' });
    if (existing) return existing;
    const clock = normalizeClock({
      chatSessionId,
      clockId: DEFAULT_CLOCK_ID,
      sceneId,
      source
    }, { chatSessionId, now: this.now });
    return manager.upsertRecord(this.collections.clocks, clock, { id });
  }

  getOrCreateInterpreterSettings(manager, { chatSessionId, source = 'system' } = {}) {
    const id = interpreterSettingsId(DEFAULT_SETTINGS_ID);
    const existing = manager.getRecord(this.collections.interpreterSettings, id, { missing: 'undefined' });
    if (existing) return existing;
    const settings = normalizeInterpreterSettings({
      chatSessionId,
      settingsId: DEFAULT_SETTINGS_ID,
      source
    }, { chatSessionId, now: this.now });
    return manager.upsertRecord(this.collections.interpreterSettings, settings, { id });
  }

  getOrCreateWorldClock(manager, {
    chatSessionId,
    worldClockId = DEFAULT_WORLD_CLOCK_ID,
    sceneId = DEFAULT_SCENE_ID,
    source = 'system'
  } = {}) {
    const normalizedWorldClockId = normalizeWorldClockId(worldClockId);
    const id = worldClockRecordId(normalizedWorldClockId);
    const existing = manager.getRecord(this.collections.worldClocks, id, { missing: 'undefined' });
    if (existing) return existing;
    const clock = this.getOrCreateClock(manager, {
      chatSessionId,
      sceneId,
      source
    });
    const worldClock = normalizeWorldClock({
      chatSessionId,
      worldClockId: normalizedWorldClockId,
      sceneId: sceneId || clock.data.sceneId,
      source
    }, {
      chatSessionId,
      clock: clock.data,
      now: this.now
    });
    return manager.upsertRecord(this.collections.worldClocks, worldClock, { id });
  }

  withTrace(operation, chatSessionId, input, fn) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const before = this.timelineSnapshot({ chatSessionId: normalizedChatSessionId });
    const trace = this.traceRecorder.start(operation, {
      sessionId: normalizedChatSessionId,
      input,
      stateBefore: before
    });
    try {
      const output = fn();
      if (output && typeof output.then === 'function') {
        return output.then((resolvedOutput) => {
          const after = this.timelineSnapshot({ chatSessionId: normalizedChatSessionId });
          return {
            ...resolvedOutput,
            trace: this.traceRecorder.finish(trace, {
              output: resolvedOutput,
              stateAfter: after
            })
          };
        }).catch((error) => {
          this.traceRecorder.fail(trace, { error });
          throw error;
        });
      }
      const after = this.timelineSnapshot({ chatSessionId: normalizedChatSessionId });
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

  openManager(chatSessionId) {
    this.ensureCollections(chatSessionId);
    return {
      manager: this.appDatabase.openChatDataManagerByChatId(chatSessionId)
    };
  }
}

export function normalizeClock(input = {}, { chatSessionId, now = () => new Date().toISOString() } = {}) {
  const timestamp = now();
  return {
    chatSessionId: normalizeRequiredText(input.chatSessionId || chatSessionId, 'chatSessionId'),
    clockId: normalizeOptionalText(input.clockId) || DEFAULT_CLOCK_ID,
    sceneId: normalizeSceneId(input.sceneId),
    phase: normalizeOptionalText(input.phase) || 'narrative',
    calendar: normalizeObject(input.calendar),
    elapsedSeconds: normalizeNonNegativeInteger(input.elapsedSeconds ?? 0, 'elapsedSeconds'),
    roundNumber: normalizeNonNegativeInteger(input.roundNumber ?? 0, 'roundNumber'),
    turnNumber: normalizeNonNegativeInteger(input.turnNumber ?? 0, 'turnNumber'),
    activeEncounterId: normalizeOptionalText(input.activeEncounterId),
    roundDurationSeconds: normalizePositiveInteger(input.roundDurationSeconds ?? DEFAULT_ROUND_SECONDS, 'roundDurationSeconds'),
    source: normalizeOptionalText(input.source) || 'system',
    clockUpdatedAt: normalizeOptionalText(input.clockUpdatedAt) || timestamp
  };
}

export function normalizeInterpreterSettings(input = {}, { chatSessionId, now = () => new Date().toISOString() } = {}) {
  const timestamp = now();
  return {
    chatSessionId: normalizeRequiredText(input.chatSessionId || chatSessionId, 'chatSessionId'),
    settingsId: normalizeOptionalText(input.settingsId) || DEFAULT_SETTINGS_ID,
    enabled: normalizeBooleanInteger(input.enabled ?? true),
    llmEnabled: normalizeBooleanInteger(input.llmEnabled ?? false),
    timeEstimationEnabled: normalizeBooleanInteger(input.timeEstimationEnabled ?? false),
    autoApply: normalizeBooleanInteger(input.autoApply ?? false),
    confidenceThreshold: normalizeProbability(input.confidenceThreshold ?? 0.75, 'confidenceThreshold'),
    confirmationThreshold: normalizeProbability(input.confirmationThreshold ?? 0.6, 'confirmationThreshold'),
    rules: mergeRulePack(DEFAULT_TIME_ADVANCE_RULES, input.rules),
    source: normalizeOptionalText(input.source) || 'system',
    settingsUpdatedAt: normalizeOptionalText(input.settingsUpdatedAt) || timestamp
  };
}

export function normalizeWorldClock(input = {}, {
  chatSessionId,
  clock = {},
  now = () => new Date().toISOString()
} = {}) {
  const timestamp = now();
  const intervalSeconds = normalizePositiveInteger(
    input.intervalSeconds ?? input.pulseIntervalSeconds ?? DEFAULT_WORLD_CLOCK_INTERVAL_SECONDS,
    'intervalSeconds'
  );
  const elapsedSeconds = normalizeNonNegativeInteger(clock.elapsedSeconds ?? 0, 'elapsedSeconds');
  const lastPulseElapsedSeconds = input.lastPulseElapsedSeconds === undefined || input.lastPulseElapsedSeconds === null || input.lastPulseElapsedSeconds === ''
    ? elapsedSeconds
    : normalizeNonNegativeInteger(input.lastPulseElapsedSeconds, 'lastPulseElapsedSeconds');
  const nextPulseElapsedSeconds = input.nextPulseElapsedSeconds === undefined || input.nextPulseElapsedSeconds === null || input.nextPulseElapsedSeconds === ''
    ? lastPulseElapsedSeconds + intervalSeconds
    : normalizeNonNegativeInteger(input.nextPulseElapsedSeconds, 'nextPulseElapsedSeconds');
  return {
    chatSessionId: normalizeRequiredText(input.chatSessionId || chatSessionId, 'chatSessionId'),
    worldClockId: normalizeWorldClockId(input.worldClockId || input.id || DEFAULT_WORLD_CLOCK_ID),
    sceneId: normalizeSceneId(input.sceneId || clock.sceneId),
    name: normalizeOptionalText(input.name) || normalizeWorldClockId(input.worldClockId || input.id || DEFAULT_WORLD_CLOCK_ID),
    enabled: normalizeBooleanInteger(input.enabled ?? true),
    status: normalizeOptionalText(input.status) || 'active',
    llmEnabled: normalizeBooleanInteger(input.llmEnabled ?? false),
    autoSchedule: normalizeBooleanInteger(input.autoSchedule ?? false),
    intervalSeconds,
    nextPulseElapsedSeconds,
    lastPulseElapsedSeconds,
    pulseCount: normalizeNonNegativeInteger(input.pulseCount ?? 0, 'pulseCount'),
    randomEventChance: normalizeProbability(input.randomEventChance ?? 0.25, 'randomEventChance'),
    npcActionChance: normalizeProbability(input.npcActionChance ?? 0.35, 'npcActionChance'),
    factionActionChance: normalizeProbability(input.factionActionChance ?? 0.3, 'factionActionChance'),
    disasterChance: normalizeProbability(input.disasterChance ?? 0.05, 'disasterChance'),
    environmentEventChance: normalizeProbability(input.environmentEventChance ?? 0.2, 'environmentEventChance'),
    maxEventsPerPulse: normalizePositiveInteger(input.maxEventsPerPulse ?? 4, 'maxEventsPerPulse'),
    eventTables: normalizeWorldEventTables(input.eventTables),
    rules: normalizeObject(input.rules),
    metadata: normalizeObject(input.metadata),
    source: normalizeOptionalText(input.source) || 'system',
    worldClockUpdatedAt: normalizeOptionalText(input.worldClockUpdatedAt) || timestamp
  };
}

export function buildWorldPulsePrompt({
  clock = {},
  worldClock = {},
  sceneId = DEFAULT_SCENE_ID,
  context = {},
  contextText = '',
  npcRefs = [],
  factionRefs = [],
  eventTables = DEFAULT_WORLD_EVENT_TABLES,
  userRules = '',
  outputMode
} = {}) {
  const schema = {
    events: [
      {
        eventId: 'stable_event_id_optional',
        category: 'npc_action | faction_action | disaster | environment_event | random_event',
        title: 'short title',
        description: 'what changes or becomes true if accepted',
        severity: 'low | medium | high | critical',
        actorId: 'optional npc/player/actor id',
        factionId: 'optional faction id',
        proposedToolCalls: [
          {
            tool: 'system.npc_behavior.resolve',
            input: { dryRun: true }
          }
        ],
        metadata: {}
      }
    ],
    narrationHints: {
      visibleToPlayers: 'what players can notice now',
      gmOnly: 'hidden consequences'
    }
  };
  return [
    'World pulse generation for an interactive text RPG.',
    'Use this to propose periodic offscreen NPC/faction/environment changes after the world clock becomes due.',
    'Do not execute tools. Return one JSON object only. Keep changes plausible, consequence-oriented, and reversible until a user or GM applies the suggested tools.',
    'Disasters may happen, including extreme events, but they must fit the current world, location, warning signs, and configured risk.',
    outputMode ? `Output mode: ${outputMode}` : '',
    `Scene id: ${normalizeSceneId(sceneId || clock.sceneId || worldClock.sceneId)}`,
    `Current clock:\n${JSON.stringify(clock || {}, null, 2)}`,
    `World clock:\n${JSON.stringify(worldClock || {}, null, 2)}`,
    `Context object:\n${JSON.stringify(context || {}, null, 2)}`,
    contextText ? `Context text:\n${contextText}` : '',
    `Candidate NPC/actor refs:\n${JSON.stringify(npcRefs || [], null, 2)}`,
    `Candidate faction refs:\n${JSON.stringify(factionRefs || [], null, 2)}`,
    `Weighted event tables:\n${JSON.stringify(eventTables || DEFAULT_WORLD_EVENT_TABLES, null, 2)}`,
    userRules ? `User/GM rules:\n${userRules}` : '',
    `Output JSON schema reference:\n${JSON.stringify(schema, null, 2)}`
  ].filter(Boolean).join('\n\n');
}

export function buildTimeAdvanceDecisionPrompt({
  text,
  settings = normalizeInterpreterSettings({ chatSessionId: 'prompt' }, { chatSessionId: 'prompt' }),
  clock,
  encounter,
  turnOrder = [],
  recentContext = '',
  sceneId
} = {}) {
  const schema = {
    action: 'none | advance_time | next_turn | advance_rounds | schedule_event',
    confidence: 0,
    needsConfirmation: true,
    reason: 'short reason',
    seconds: 0,
    rounds: 0,
    event: {
      title: 'string',
      afterRounds: 0,
      afterSeconds: 0
    },
    proposedToolCalls: [
      {
        tool: 'system.time.advance_time',
        input: {}
      }
    ],
    matchedRuleId: 'string'
  };
  return [
    'Decide whether the following free-form text RPG action should advance time, end the current turn, advance whole rounds, or schedule a future event.',
    'Be conservative. If the player may still have movement, bonus action, reaction, or unresolved choices, set needsConfirmation=true.',
    'Use the campaign rule pack below before guessing. Explicit user time always wins. Explicit "end turn" always becomes next_turn during an active encounter.',
    settings.timeEstimationEnabled
      ? 'Fuzzy narrative time estimation is enabled: you may propose elapsed seconds for non-explicit activities when confidence is high.'
      : 'Fuzzy narrative time estimation is disabled: do not propose elapsed seconds for non-explicit activities. Prefer none or next_turn/advance_rounds decisions.',
    'Do not execute tools. Return exactly one JSON object matching the schema.',
    `Text:\n${String(text || '')}`,
    recentContext ? `Recent context:\n${recentContext}` : '',
    `Current clock:\n${JSON.stringify(clock || {}, null, 2)}`,
    `Current encounter:\n${JSON.stringify(encounter || null, null, 2)}`,
    `Active turn order:\n${JSON.stringify(turnOrder || [], null, 2)}`,
    sceneId ? `Scene id: ${sceneId}` : '',
    `Rule pack:\n${JSON.stringify(settings.rules || DEFAULT_TIME_ADVANCE_RULES, null, 2)}`,
    `Decision thresholds:\n${JSON.stringify({
      confidenceThreshold: settings.confidenceThreshold,
      confirmationThreshold: settings.confirmationThreshold,
      timeEstimationEnabled: Boolean(settings.timeEstimationEnabled)
    }, null, 2)}`,
    `Output JSON schema reference:\n${JSON.stringify(schema, null, 2)}`
  ].filter(Boolean).join('\n\n');
}

export function interpretAdvanceWithRules(text, {
  settings = normalizeInterpreterSettings({ chatSessionId: 'rules' }, { chatSessionId: 'rules' }),
  clock = {},
  encounter,
  turnOrder = [],
  sceneId
} = {}) {
  const rules = mergeRulePack(DEFAULT_TIME_ADVANCE_RULES, settings.rules);
  const normalizedText = normalizeSearchText(text);
  const activeEncounter = encounter && String(encounter.status || 'active') === 'active';
  const threshold = Number(settings.confidenceThreshold ?? 0.75);

  const explicitDuration = parseExplicitDuration(text);
  if (explicitDuration) {
    if (explicitDuration.unit === 'rounds') {
      const participants = Math.max(1, turnOrder.length);
      const repeat = activeEncounter ? explicitDuration.value * participants : 0;
      return normalizeAdvanceDecision({
        action: activeEncounter ? 'advance_rounds' : 'advance_time',
        confidence: 0.96,
        needsConfirmation: false,
        reason: `explicit duration: ${explicitDuration.raw}`,
        rounds: activeEncounter ? explicitDuration.value : undefined,
        seconds: activeEncounter ? undefined : explicitDuration.value * Number(clock.roundDurationSeconds || DEFAULT_ROUND_SECONDS),
        proposedToolCalls: activeEncounter
          ? [{ tool: 'system.time.next_turn', input: { encounterId: encounter.encounterId }, repeat }]
          : [{ tool: 'system.time.advance_time', input: { seconds: explicitDuration.value * Number(clock.roundDurationSeconds || DEFAULT_ROUND_SECONDS), phase: 'scene' } }],
        matchedRuleId: 'explicit_duration',
        matched: true,
        source: 'rules'
      }, { settings, clock, encounter, turnOrder, sceneId });
    }
    return normalizeAdvanceDecision({
      action: 'advance_time',
      confidence: 0.97,
      needsConfirmation: false,
      reason: `explicit duration: ${explicitDuration.raw}`,
      seconds: explicitDuration.seconds,
      proposedToolCalls: [{ tool: 'system.time.advance_time', input: { seconds: explicitDuration.seconds, phase: 'scene' } }],
      matchedRuleId: 'explicit_duration',
      matched: true,
      source: 'rules'
    }, { settings, clock, encounter, turnOrder, sceneId });
  }

  const noAdvance = findMatchingRule(rules.noAdvance, normalizedText);
  if (noAdvance) {
    return noAdvanceDecision({
      confidence: noAdvance.confidence ?? 0.85,
      reason: `matched no-advance rule: ${noAdvance.id}`,
      matchedRuleId: noAdvance.id,
      matched: true,
      source: 'rules'
    });
  }

  if (activeEncounter) {
    const explicitTurnEnd = findMatchingRule(rules.explicitTurnEnd, normalizedText);
    if (explicitTurnEnd) {
      return normalizeAdvanceDecision({
        action: 'next_turn',
        confidence: explicitTurnEnd.confidence ?? 0.95,
        needsConfirmation: false,
        reason: `matched explicit turn-end rule: ${explicitTurnEnd.id}`,
        proposedToolCalls: [{ tool: 'system.time.next_turn', input: { encounterId: encounter.encounterId } }],
        matchedRuleId: explicitTurnEnd.id,
        matched: true,
        source: 'rules'
      }, { settings, clock, encounter, turnOrder, sceneId });
    }

    const completedTurn = findMatchingRule(rules.completedTurn, normalizedText);
    if (completedTurn) {
      const confidence = completedTurn.confidence ?? 0.75;
      return normalizeAdvanceDecision({
        action: 'next_turn',
        confidence,
        needsConfirmation: confidence < threshold,
        reason: `matched completed-turn rule: ${completedTurn.id}`,
        proposedToolCalls: [{ tool: 'system.time.next_turn', input: { encounterId: encounter.encounterId } }],
        matchedRuleId: completedTurn.id,
        matched: true,
        source: 'rules'
      }, { settings, clock, encounter, turnOrder, sceneId });
    }

    const maybeProgress = findMatchingRule(rules.maybeTurnProgress, normalizedText);
    if (maybeProgress) {
      return normalizeAdvanceDecision({
        action: 'next_turn',
        confidence: maybeProgress.confidence ?? 0.55,
        needsConfirmation: true,
        reason: `matched partial-turn rule: ${maybeProgress.id}`,
        proposedToolCalls: [{ tool: 'system.time.next_turn', input: { encounterId: encounter.encounterId } }],
        matchedRuleId: maybeProgress.id,
        matched: true,
        source: 'rules'
      }, { settings, clock, encounter, turnOrder, sceneId });
    }
  }

  const timeAdvance = settings.timeEstimationEnabled
    ? findMatchingRule(rules.timeAdvance, normalizedText)
    : undefined;
  if (timeAdvance) {
    const seconds = ruleDurationSeconds(timeAdvance);
    const confidence = timeAdvance.confidence ?? 0.7;
    return normalizeAdvanceDecision({
      action: 'advance_time',
      confidence,
      needsConfirmation: confidence < threshold,
      reason: `matched time-advance rule: ${timeAdvance.id}`,
      seconds,
      proposedToolCalls: [{ tool: 'system.time.advance_time', input: { seconds, phase: activeEncounter ? 'turn' : 'scene' } }],
      matchedRuleId: timeAdvance.id,
      matched: true,
      source: 'rules'
    }, { settings, clock, encounter, turnOrder, sceneId });
  }

  return noAdvanceDecision({
    confidence: 0.5,
    reason: 'no deterministic time rule matched',
    matched: false,
    source: 'rules'
  });
}

export function normalizeAdvanceDecision(input = {}, { settings = {}, clock = {}, encounter, turnOrder = [], sceneId } = {}) {
  const action = normalizeAdvanceAction(input.action);
  const confidence = normalizeProbability(input.confidence ?? 0.5, 'confidence');
  const seconds = input.seconds === undefined || input.seconds === null || input.seconds === '' ? undefined : normalizeNonNegativeInteger(input.seconds, 'seconds');
  const rounds = input.rounds === undefined || input.rounds === null || input.rounds === '' ? undefined : normalizeNonNegativeInteger(input.rounds, 'rounds');
  const needsConfirmation = input.needsConfirmation !== undefined
    ? Boolean(input.needsConfirmation)
    : confidence < Number(settings.confidenceThreshold ?? 0.75);
  const proposedToolCalls = Array.isArray(input.proposedToolCalls) && input.proposedToolCalls.length
    ? input.proposedToolCalls
    : buildProposedToolCalls({ action, seconds, rounds, encounter, turnOrder, event: input.event });
  return {
    action,
    confidence,
    needsConfirmation,
    reason: normalizeOptionalText(input.reason),
    seconds,
    rounds,
    event: normalizeObject(input.event),
    proposedToolCalls,
    matchedRuleId: normalizeOptionalText(input.matchedRuleId),
    matched: Boolean(input.matched),
    source: normalizeOptionalText(input.source) || 'rules',
    sceneId: normalizeSceneId(input.sceneId || sceneId || clock.sceneId),
    clock: {
      elapsedSeconds: clock.elapsedSeconds,
      roundNumber: clock.roundNumber,
      turnNumber: clock.turnNumber,
      activeEncounterId: clock.activeEncounterId
    }
  };
}

function normalizeParticipants(participants, options) {
  return (Array.isArray(participants) ? participants : [participants])
    .filter((participant) => participant && typeof participant === 'object' && !Array.isArray(participant))
    .map((participant, index) => normalizeParticipant(participant, { ...options, index }));
}

function normalizeParticipant(input = {}, { chatSessionId, encounterId, sceneId, index = 0, now = () => new Date().toISOString() } = {}) {
  const participantId = normalizeParticipantId(input.participantId || input.actorId || input.npcId || input.id || input.name);
  return {
    chatSessionId: normalizeRequiredText(input.chatSessionId || chatSessionId, 'chatSessionId'),
    encounterId: normalizeEncounterId(input.encounterId || encounterId),
    sceneId: normalizeSceneId(input.sceneId || sceneId),
    participantId,
    name: normalizeOptionalText(input.name) || participantId,
    actorType: normalizeOptionalText(input.actorType || input.type) || 'npc',
    initiative: normalizeNumber(input.initiative ?? input.initiativeScore ?? 0, 'initiative'),
    initiativeRoll: normalizeObject(input.initiativeRoll),
    dexterityModifier: normalizeInteger(input.dexterityModifier ?? input.dexMod ?? 0, 'dexterityModifier'),
    orderIndex: normalizeNonNegativeInteger(input.orderIndex ?? index, 'orderIndex'),
    status: normalizeOptionalText(input.status) || 'active',
    hasActed: input.hasActed ? 1 : 0,
    actionState: defaultActionState(input.actionState),
    tags: normalizeStringArray(input.tags),
    metadata: normalizeObject(input.metadata),
    turnStartedAt: normalizeOptionalText(input.turnStartedAt),
    turnUpdatedAt: normalizeOptionalText(input.turnUpdatedAt) || now()
  };
}

function normalizeEffect(input = {}, { chatSessionId, encounterId = '', sceneId = DEFAULT_SCENE_ID, existing, now = () => new Date().toISOString() } = {}) {
  const timestamp = now();
  const effectId = normalizeEffectId(input.effectId || input.id || input.name || `${input.targetParticipantId || 'effect'}_${timestamp}`);
  const remainingRounds = input.remainingRounds ?? input.durationRounds ?? input.rounds ?? existing?.remainingRounds;
  const remainingSeconds = input.remainingSeconds ?? input.durationSeconds ?? existing?.remainingSeconds;
  return {
    chatSessionId: normalizeRequiredText(input.chatSessionId || chatSessionId, 'chatSessionId'),
    encounterId: normalizeOptionalText(input.encounterId ?? encounterId),
    sceneId: normalizeSceneId(input.sceneId || sceneId),
    effectId,
    name: normalizeOptionalText(input.name) || effectId,
    effectType: normalizeOptionalText(input.effectType || input.type) || 'condition',
    ownerParticipantId: normalizeOptionalText(input.ownerParticipantId || input.ownerId || existing?.ownerParticipantId),
    targetParticipantId: normalizeOptionalText(input.targetParticipantId || input.targetId || existing?.targetParticipantId),
    status: normalizeOptionalText(input.status || existing?.status) || 'active',
    durationType: normalizeOptionalText(input.durationType || existing?.durationType) || (remainingRounds !== undefined ? 'rounds' : (remainingSeconds !== undefined ? 'seconds' : 'scene')),
    remainingRounds: remainingRounds === undefined || remainingRounds === null || remainingRounds === '' ? undefined : normalizeNonNegativeInteger(remainingRounds, 'remainingRounds'),
    remainingSeconds: remainingSeconds === undefined || remainingSeconds === null || remainingSeconds === '' ? undefined : normalizeNonNegativeInteger(remainingSeconds, 'remainingSeconds'),
    tickTiming: normalizeOptionalText(input.tickTiming || existing?.tickTiming) || 'endRound',
    values: normalizeNumericObject(input.values ?? existing?.values),
    metadata: normalizeObject(input.metadata ?? existing?.metadata),
    source: normalizeOptionalText(input.source || existing?.source) || 'agent',
    createdAtIso: normalizeOptionalText(existing?.createdAtIso || input.createdAtIso) || timestamp,
    effectUpdatedAt: timestamp
  };
}

function normalizeScheduledEvent(input = {}, { chatSessionId, clock, encounter, now = () => new Date().toISOString() } = {}) {
  const timestamp = now();
  const eventId = normalizeEventId(input.eventId || input.id || input.title || `event_${timestamp}`);
  const afterSeconds = normalizeOptionalDurationSeconds(input);
  const afterRounds = input.afterRounds === undefined || input.afterRounds === null || input.afterRounds === ''
    ? undefined
    : normalizeNonNegativeInteger(input.afterRounds, 'afterRounds');
  const dueElapsedSeconds = input.dueElapsedSeconds !== undefined
    ? normalizeNonNegativeInteger(input.dueElapsedSeconds, 'dueElapsedSeconds')
    : (afterSeconds !== undefined ? Number(clock?.elapsedSeconds || 0) + afterSeconds : undefined);
  const dueRound = input.dueRound !== undefined
    ? normalizeNonNegativeInteger(input.dueRound, 'dueRound')
    : (afterRounds !== undefined ? Number(encounter?.roundNumber || clock?.roundNumber || 0) + afterRounds : undefined);
  return {
    chatSessionId: normalizeRequiredText(input.chatSessionId || chatSessionId, 'chatSessionId'),
    encounterId: normalizeOptionalText(input.encounterId || encounter?.encounterId),
    sceneId: normalizeSceneId(input.sceneId || encounter?.sceneId || clock?.sceneId),
    eventId,
    title: normalizeOptionalText(input.title) || eventId,
    description: normalizeOptionalText(input.description),
    status: normalizeOptionalText(input.status) || 'scheduled',
    triggerType: normalizeOptionalText(input.triggerType) || (dueRound !== undefined ? 'round' : 'elapsedSeconds'),
    dueElapsedSeconds,
    dueRound,
    dueTurnIndex: input.dueTurnIndex === undefined || input.dueTurnIndex === null || input.dueTurnIndex === '' ? undefined : normalizeNonNegativeInteger(input.dueTurnIndex, 'dueTurnIndex'),
    payload: normalizeObject(input.payload),
    metadata: normalizeObject(input.metadata),
    source: normalizeOptionalText(input.source) || 'agent',
    createdAtIso: normalizeOptionalText(input.createdAtIso) || timestamp,
    resolvedAt: normalizeOptionalText(input.resolvedAt),
    eventUpdatedAt: timestamp
  };
}

function noAdvanceDecision(input = {}) {
  return {
    action: 'none',
    confidence: normalizeProbability(input.confidence ?? 0.5, 'confidence'),
    needsConfirmation: false,
    reason: normalizeOptionalText(input.reason),
    proposedToolCalls: [],
    matchedRuleId: normalizeOptionalText(input.matchedRuleId),
    matched: Boolean(input.matched),
    source: normalizeOptionalText(input.source) || 'rules'
  };
}

function suppressFuzzyTimeEstimation(llmDecision, fallbackDecision) {
  if (llmDecision.action !== 'advance_time') return llmDecision;
  if (fallbackDecision?.matchedRuleId === 'explicit_duration') return llmDecision;
  return noAdvanceDecision({
    confidence: Math.max(0.5, Number(fallbackDecision?.confidence || 0.5)),
    reason: 'LLM proposed elapsed time, but timeEstimationEnabled is disabled',
    matched: Boolean(fallbackDecision?.matched),
    matchedRuleId: fallbackDecision?.matchedRuleId,
    source: 'settings'
  });
}

function normalizeAdvanceAction(value) {
  const action = normalizeOptionalText(value) || 'none';
  if (['none', 'advance_time', 'next_turn', 'advance_rounds', 'schedule_event'].includes(action)) return action;
  throw validationError(`Unsupported time advance action: ${action}`);
}

function buildProposedToolCalls({ action, seconds, rounds, encounter, turnOrder = [], event } = {}) {
  if (action === 'advance_time' && seconds !== undefined) {
    return [{ tool: 'system.time.advance_time', input: { seconds, phase: encounter ? 'turn' : 'scene' } }];
  }
  if (action === 'next_turn') {
    return [{ tool: 'system.time.next_turn', input: { encounterId: encounter?.encounterId } }];
  }
  if (action === 'advance_rounds') {
    const repeat = Math.max(1, Number(rounds || 1)) * Math.max(1, turnOrder.length || 1);
    return [{ tool: 'system.time.next_turn', input: { encounterId: encounter?.encounterId }, repeat }];
  }
  if (action === 'schedule_event') {
    return [{ tool: 'system.time.schedule_event', input: normalizeObject(event) }];
  }
  return [];
}

function createWorldPulse({
  chatSessionId,
  clock,
  worldClock,
  sceneId,
  dueInfo,
  eventTables,
  npcRefs = [],
  factionRefs = [],
  maxEventsPerPulse = 4,
  chances = {},
  random = secureRandom,
  now = () => new Date().toISOString(),
  input = {}
} = {}) {
  const data = worldClock.data || worldClock || {};
  const clockData = clock.data || clock || {};
  const pulseNumber = Number(data.pulseCount || 0) + 1;
  const normalizedSceneId = normalizeSceneId(sceneId || data.sceneId || clockData.sceneId);
  const pulseId = normalizeEventId(`world_pulse_${data.worldClockId || DEFAULT_WORLD_CLOCK_ID}_${pulseNumber}_${clockData.elapsedSeconds || 0}`);
  const events = [];
  const skipped = [];
  const categorySpecs = [
    {
      category: 'npc_action',
      tableName: 'npcActions',
      chance: chances.npcActionChance,
      refs: npcRefs,
      refKind: 'actor'
    },
    {
      category: 'faction_action',
      tableName: 'factionActions',
      chance: chances.factionActionChance,
      refs: factionRefs,
      refKind: 'faction'
    },
    {
      category: 'disaster',
      tableName: 'disasters',
      chance: chances.disasterChance,
      refs: [],
      refKind: 'scene'
    },
    {
      category: 'environment_event',
      tableName: 'environmentEvents',
      chance: chances.environmentEventChance,
      refs: [],
      refKind: 'scene'
    },
    {
      category: 'random_event',
      tableName: 'randomEvents',
      chance: chances.randomEventChance,
      refs: [...npcRefs, ...factionRefs],
      refKind: 'mixed'
    }
  ];

  for (const spec of categorySpecs) {
    if (events.length >= maxEventsPerPulse) break;
    const chance = normalizeProbability(spec.chance ?? 0, `${spec.category}Chance`);
    const roll = boundedRandom(random);
    if (roll >= chance) {
      skipped.push({ category: spec.category, reason: 'chance_missed', roll, chance });
      continue;
    }
    const table = eventTables?.[spec.tableName] || [];
    const entry = chooseWeighted(table, random);
    if (!entry) {
      skipped.push({ category: spec.category, reason: 'empty_table', chance });
      continue;
    }
    const target = selectReference(spec.refs, random);
    events.push(createWorldPulseEvent({
      chatSessionId,
      pulseId,
      pulseNumber,
      category: spec.category,
      entry,
      target,
      refKind: spec.refKind,
      clock: clockData,
      worldClock: data,
      sceneId: normalizedSceneId,
      index: events.length,
      source: 'table'
    }));
  }

  return {
    pulseId,
    worldClockId: data.worldClockId || DEFAULT_WORLD_CLOCK_ID,
    pulseNumber,
    generatedAt: now(),
    sceneId: normalizedSceneId,
    elapsedSeconds: Number(clockData.elapsedSeconds || 0),
    dueInfo,
    source: 'table',
    events,
    proposedToolCalls: events.flatMap((event) => event.proposedToolCalls || []),
    skipped,
    settings: {
      maxEventsPerPulse,
      chances
    },
    context: normalizeObject(input.context)
  };
}

function emptyWorldPulse(prepared, { prompt } = {}) {
  const data = prepared.worldClock.data || {};
  const clock = prepared.clock.data || {};
  const pulseNumber = Number(data.pulseCount || 0) + 1;
  return {
    pulseId: normalizeEventId(`world_pulse_${data.worldClockId || DEFAULT_WORLD_CLOCK_ID}_${pulseNumber}_${clock.elapsedSeconds || 0}`),
    worldClockId: data.worldClockId || DEFAULT_WORLD_CLOCK_ID,
    pulseNumber,
    generatedAt: '',
    sceneId: prepared.sceneId,
    elapsedSeconds: Number(clock.elapsedSeconds || 0),
    dueInfo: prepared.dueInfo,
    source: 'none',
    events: [],
    proposedToolCalls: [],
    skipped: [],
    prompt
  };
}

async function maybeGenerateLlmWorldPulse({
  input = {},
  chatProvider,
  prompt,
  prepared,
  basePulse
} = {}) {
  const worldClock = prepared.worldClock.data || {};
  const shouldUseLlm = Boolean(input.useLlm ?? worldClock.llmEnabled);
  if (!shouldUseLlm) return { used: false, reason: 'llm_disabled' };
  if (!chatProvider || typeof chatProvider.generate !== 'function') {
    return { used: false, reason: 'chatProvider_missing' };
  }
  const completion = await chatProvider.generate({
    messages: [
      {
        role: 'system',
        content: 'You propose periodic world-clock events for an interactive text RPG. Return JSON only.'
      },
      { role: 'user', content: prompt }
    ],
    temperature: input.temperature ?? 0.3,
    maxTokens: input.maxTokens || 1600
  });
  const parsed = parseJsonObject(completion.content);
  const events = normalizeWorldPulseEvents(parsed.events || parsed.worldEvents || parsed.proposals || [], {
    prepared,
    basePulse,
    source: 'llm'
  });
  return {
    used: true,
    content: completion.content,
    raw: completion.raw,
    events,
    narrationHints: normalizeObject(parsed.narrationHints)
  };
}

function normalizeWorldPulseEvents(events, { prepared, basePulse, source = 'llm' } = {}) {
  return (Array.isArray(events) ? events : [events])
    .filter((event) => event && typeof event === 'object' && !Array.isArray(event))
    .map((event, index) => {
      const category = normalizeWorldPulseCategory(event.category || event.type);
      const target = normalizeReference(event.actorId || event.npcId || event.targetId
        ? {
          id: event.actorId || event.npcId || event.targetId,
          name: event.actorName || event.npcName || event.targetName,
          actorType: event.actorType || 'npc'
        }
        : (event.factionId ? { factionId: event.factionId, id: event.factionId, name: event.factionName } : event.target));
      return createWorldPulseEvent({
        chatSessionId: prepared.chatSessionId,
        pulseId: basePulse.pulseId,
        pulseNumber: basePulse.pulseNumber,
        category,
        entry: {
          ...event,
          id: event.eventId || event.id || `${category}_${index}`,
          title: event.title,
          description: event.description || event.summary,
          severity: event.severity,
          proposedToolCalls: event.proposedToolCalls || event.recommendedToolCalls || event.toolCalls
        },
        target,
        refKind: event.factionId ? 'faction' : (event.actorId || event.npcId ? 'actor' : 'scene'),
        clock: prepared.clock.data,
        worldClock: prepared.worldClock.data,
        sceneId: event.sceneId || prepared.sceneId,
        index,
        source
      });
    });
}

function createWorldPulseEvent({
  chatSessionId,
  pulseId,
  pulseNumber,
  category,
  entry,
  target = {},
  refKind,
  clock,
  worldClock,
  sceneId,
  index = 0,
  source = 'table'
} = {}) {
  const normalizedCategory = normalizeWorldPulseCategory(category);
  const title = normalizeOptionalText(entry.title || entry.name) || normalizedCategory;
  const description = normalizeOptionalText(entry.description || entry.summary);
  const severity = normalizeOptionalText(entry.severity) || defaultWorldPulseSeverity(normalizedCategory);
  const actorId = normalizeOptionalText(entry.actorId || entry.npcId || (refKind === 'actor' ? target.id || target.actorId || target.npcId : ''));
  const factionId = normalizeOptionalText(entry.factionId || (refKind === 'faction' ? target.factionId || target.id : ''));
  const eventId = normalizeEventId(entry.eventId || entry.id && `${pulseId}_${entry.id}` || `${pulseId}_${normalizedCategory}_${index + 1}`);
  const proposedToolCalls = normalizeProposedToolCalls(entry.proposedToolCalls)
    || buildWorldPulseToolCalls({
      chatSessionId,
      sceneId,
      category: normalizedCategory,
      eventId,
      title,
      description,
      severity,
      actorId,
      factionId,
      entry
    });
  const payload = {
    kind: 'world_pulse_event',
    pulseId,
    pulseNumber,
    worldClockId: worldClock.worldClockId || DEFAULT_WORLD_CLOCK_ID,
    category: normalizedCategory,
    severity,
    actorId,
    factionId,
    target,
    template: entry,
    proposedToolCalls
  };
  return {
    eventId,
    pulseId,
    pulseNumber,
    category: normalizedCategory,
    title,
    description,
    severity,
    sceneId: normalizeSceneId(sceneId || clock.sceneId || worldClock.sceneId),
    actorId,
    factionId,
    target,
    source,
    proposedToolCalls,
    scheduleEvent: {
      chatSessionId,
      sceneId: normalizeSceneId(sceneId || clock.sceneId || worldClock.sceneId),
      eventId,
      title,
      description,
      status: 'due',
      triggerType: 'elapsedSeconds',
      dueElapsedSeconds: normalizeNonNegativeInteger(clock.elapsedSeconds ?? 0, 'dueElapsedSeconds'),
      payload,
      metadata: {
        kind: 'world_pulse_event',
        pulseId,
        pulseNumber,
        worldClockId: worldClock.worldClockId || DEFAULT_WORLD_CLOCK_ID,
        category: normalizedCategory,
        severity,
        source
      },
      source: 'world-clock'
    }
  };
}

function buildWorldPulseToolCalls({
  chatSessionId,
  sceneId,
  category,
  eventId,
  title,
  description,
  severity,
  actorId,
  factionId,
  entry = {}
} = {}) {
  const triggerText = `${title}${description ? `: ${description}` : ''}`;
  if (category === 'npc_action') {
    return [
      {
        tool: 'system.npc_behavior.resolve',
        input: {
          chatSessionId,
          sceneId,
          triggerText,
          triggerType: 'world_clock_pulse',
          triggerSummary: title,
          actorNpcIds: actorId ? [actorId] : [],
          templateId: entry.templateId || 'generic',
          dryRun: true
        }
      }
    ];
  }
  if (category === 'faction_action') {
    return [
      factionId
        ? { tool: 'system.factions.get_faction', input: { factionId } }
        : { tool: 'system.factions.list_factions', input: { query: title, limit: 10 } },
      {
        tool: 'system.factions.patch_faction',
        input: {
          factionId: factionId || '${factionId}',
          patch: {
            metadata: {
              pendingWorldClockEvent: eventId,
              pendingWorldClockSeverity: severity,
              pendingWorldClockSummary: triggerText
            }
          }
        }
      }
    ];
  }
  if (category === 'disaster' || category === 'environment_event') {
    return [
      {
        tool: 'system.map_state.patch_state',
        input: {
          chatSessionId,
          sceneId,
          hazards: [
            {
              id: eventId,
              name: title,
              severity,
              description,
              source: 'world-clock'
            }
          ],
          source: 'world-clock'
        }
      },
      {
        tool: 'system.npc_behavior.resolve',
        input: {
          chatSessionId,
          sceneId,
          triggerText,
          triggerType: 'world_clock_hazard',
          triggerSummary: title,
          templateId: 'generic',
          dryRun: true
        }
      }
    ];
  }
  return [
    {
      tool: 'system.time.schedule_event',
      input: {
        chatSessionId,
        sceneId,
        eventId,
        title,
        description,
        status: 'due',
        source: 'world-clock'
      }
    }
  ];
}

function advanceWorldClockAfterPulse(worldClock, { clock, now = () => new Date().toISOString() } = {}) {
  const elapsedSeconds = normalizeNonNegativeInteger(clock.elapsedSeconds ?? 0, 'elapsedSeconds');
  const intervalSeconds = normalizePositiveInteger(worldClock.intervalSeconds || DEFAULT_WORLD_CLOCK_INTERVAL_SECONDS, 'intervalSeconds');
  let nextPulseElapsedSeconds = normalizeNonNegativeInteger(worldClock.nextPulseElapsedSeconds ?? elapsedSeconds + intervalSeconds, 'nextPulseElapsedSeconds');
  while (nextPulseElapsedSeconds <= elapsedSeconds) {
    nextPulseElapsedSeconds += intervalSeconds;
  }
  return normalizeWorldClock({
    ...worldClock,
    lastPulseElapsedSeconds: elapsedSeconds,
    nextPulseElapsedSeconds,
    pulseCount: Number(worldClock.pulseCount || 0) + 1,
    source: 'world-clock',
    worldClockUpdatedAt: now()
  }, {
    chatSessionId: worldClock.chatSessionId,
    clock,
    now
  });
}

function worldClockDueInfo(worldClock = {}, clock = {}, force = false) {
  const elapsedSeconds = normalizeNonNegativeInteger(clock.elapsedSeconds ?? 0, 'elapsedSeconds');
  const nextPulseElapsedSeconds = normalizeNonNegativeInteger(
    worldClock.nextPulseElapsedSeconds ?? elapsedSeconds + normalizePositiveInteger(worldClock.intervalSeconds || DEFAULT_WORLD_CLOCK_INTERVAL_SECONDS, 'intervalSeconds'),
    'nextPulseElapsedSeconds'
  );
  const canPulse = worldClockCanPulse(worldClock);
  return {
    due: Boolean(force || (canPulse && elapsedSeconds >= nextPulseElapsedSeconds)),
    force: Boolean(force),
    canPulse,
    enabled: Boolean(worldClock.enabled),
    status: normalizeOptionalText(worldClock.status) || 'active',
    elapsedSeconds,
    nextPulseElapsedSeconds,
    secondsUntilNextPulse: Math.max(0, nextPulseElapsedSeconds - elapsedSeconds),
    disabledReason: canPulse || force ? '' : 'world clock disabled or paused'
  };
}

function worldClockCanPulse(worldClock = {}) {
  if (!worldClock.enabled) return false;
  const status = normalizeOptionalText(worldClock.status || 'active').toLowerCase();
  return !['paused', 'archived', 'disabled', 'off'].includes(status);
}

function normalizeWorldEventTables(input) {
  const table = normalizeObject(input);
  const output = {};
  for (const key of ['npcActions', 'factionActions', 'disasters', 'environmentEvents', 'randomEvents']) {
    output[key] = normalizeWorldEventEntries(table[key] ?? DEFAULT_WORLD_EVENT_TABLES[key]);
  }
  return output;
}

function normalizeWorldEventEntries(entries) {
  return (Array.isArray(entries) ? entries : [entries])
    .filter((entry) => entry !== undefined && entry !== null && entry !== '')
    .map((entry, index) => {
      if (typeof entry === 'string') {
        return {
          id: safeSegment(entry) || `entry_${index + 1}`,
          title: entry,
          description: '',
          severity: 'medium',
          weight: 1
        };
      }
      const object = normalizeObject(entry);
      return {
        ...object,
        id: normalizeOptionalText(object.id || object.eventId || object.name || object.title) || `entry_${index + 1}`,
        title: normalizeOptionalText(object.title || object.name) || `World event ${index + 1}`,
        description: normalizeOptionalText(object.description || object.summary),
        severity: normalizeOptionalText(object.severity) || 'medium',
        weight: normalizePositiveNumber(object.weight ?? 1, 'weight')
      };
    });
}

function normalizeWorldPulseCategory(value) {
  const category = normalizeOptionalText(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (['npc_action', 'npc', 'actor_action', 'actor'].includes(category)) return 'npc_action';
  if (['faction_action', 'faction'].includes(category)) return 'faction_action';
  if (['disaster', 'hazard', 'catastrophe'].includes(category)) return 'disaster';
  if (['environment_event', 'environment', 'map_event', 'scene_event'].includes(category)) return 'environment_event';
  if (['random_event', 'random', 'misc'].includes(category)) return 'random_event';
  return 'random_event';
}

function defaultWorldPulseSeverity(category) {
  if (category === 'disaster') return 'high';
  if (category === 'faction_action') return 'medium';
  if (category === 'npc_action') return 'medium';
  return 'low';
}

function chooseWeighted(entries = [], random = secureRandom) {
  const normalized = normalizeWorldEventEntries(entries);
  if (normalized.length === 0) return undefined;
  const total = normalized.reduce((sum, entry) => sum + Number(entry.weight || 1), 0);
  let roll = boundedRandom(random) * total;
  for (const entry of normalized) {
    roll -= Number(entry.weight || 1);
    if (roll <= 0) return entry;
  }
  return normalized[normalized.length - 1];
}

function selectReference(refs = [], random = secureRandom) {
  const normalized = normalizeReferenceArray(refs);
  if (normalized.length === 0) return {};
  return normalized[Math.min(normalized.length - 1, Math.floor(boundedRandom(random) * normalized.length))];
}

function normalizeReferenceArray(value, { idField = 'id' } = {}) {
  if (value === undefined || value === null || value === '') return [];
  return (Array.isArray(value) ? value : [value])
    .flatMap((item) => typeof item === 'string' ? item.split(',') : [item])
    .map((item) => normalizeReference(item, { idField }))
    .filter((item) => item.id || item.actorId || item.npcId || item.factionId || item.name);
}

function normalizeReference(value, { idField = 'id' } = {}) {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value === 'string') {
    const text = value.trim();
    return {
      id: safeSegment(text) || text,
      [idField]: safeSegment(text) || text,
      name: text
    };
  }
  const object = normalizeObject(value);
  const id = normalizeOptionalText(object.id || object.actorId || object.npcId || object.factionId || object.name);
  return {
    ...object,
    id: normalizeOptionalText(object.id) || id,
    [idField]: normalizeOptionalText(object[idField]) || id,
    name: normalizeOptionalText(object.name || object.actorName || object.npcName || object.factionName) || id
  };
}

function normalizeContextValue(value) {
  if (!value) return {};
  if (typeof value === 'string') return { text: value };
  return normalizeObject(value);
}

function normalizeProposedToolCalls(value) {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((call) => call && typeof call === 'object' && !Array.isArray(call))
    .map((call) => ({
      tool: normalizeOptionalText(call.tool || call.toolId || call.name),
      input: normalizeObject(call.input || call.arguments)
    }))
    .filter((call) => call.tool);
}

function boundedRandom(random = secureRandom) {
  const value = Number(random());
  if (!Number.isFinite(value)) return secureRandom();
  if (value <= 0) return 0;
  if (value >= 1) return 0.999999999;
  return value;
}

function secureRandom() {
  return randomInt(0, 1_000_000) / 1_000_000;
}

function parseExplicitDuration(text) {
  const source = String(text || '');
  const patterns = [
    /([0-9]+|[一二两三四五六七八九十百]+)\s*(秒|秒钟|分钟|分|小时|钟头|天|日|回合|轮)/i,
    /(?:等|等待|休息|经过|花费|耗时)\s*([0-9]+|[一二两三四五六七八九十百]+)\s*(秒|秒钟|分钟|分|小时|钟头|天|日|回合|轮)/i
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match) continue;
    const value = parseSmallInteger(match[1]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const unit = match[2];
    if (['回合', '轮'].includes(unit)) {
      return {
        raw: match[0],
        value,
        unit: 'rounds'
      };
    }
    return {
      raw: match[0],
      value,
      unit,
      seconds: value * chineseUnitToSeconds(unit)
    };
  }
  return undefined;
}

function parseSmallInteger(value) {
  const text = String(value || '').trim();
  if (/^\d+$/.test(text)) return Number(text);
  const digits = {
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
  const hundredParts = text.split('百');
  if (hundredParts.length === 2) {
    return (digits[hundredParts[0]] || 1) * 100 + parseSmallInteger(hundredParts[1] || '零');
  }
  const tenParts = text.split('十');
  if (tenParts.length === 2) {
    return (tenParts[0] ? digits[tenParts[0]] : 1) * 10 + (tenParts[1] ? digits[tenParts[1]] : 0);
  }
  return digits[text];
}

function chineseUnitToSeconds(unit) {
  if (['秒', '秒钟'].includes(unit)) return 1;
  if (['分钟', '分'].includes(unit)) return 60;
  if (['小时', '钟头'].includes(unit)) return 3600;
  if (['天', '日'].includes(unit)) return 86400;
  throw validationError(`Unsupported duration unit: ${unit}`);
}

function findMatchingRule(rules = [], normalizedText = '') {
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (!rule || typeof rule !== 'object') continue;
    if (rule.regex) {
      try {
        if (new RegExp(rule.regex, 'i').test(normalizedText)) return rule;
      } catch {
        // Ignore invalid user rule regex. It remains visible in the settings record.
      }
    }
    const keywords = normalizeStringArray(rule.keywords).map(normalizeSearchText);
    if (keywords.length > 0 && keywords.some((keyword) => normalizedText.includes(keyword))) return rule;
    const allKeywords = normalizeStringArray(rule.allKeywords).map(normalizeSearchText);
    if (allKeywords.length > 0 && allKeywords.every((keyword) => normalizedText.includes(keyword))) return rule;
  }
  return undefined;
}

function ruleDurationSeconds(rule = {}) {
  const seconds = Number(rule.seconds ?? 0)
    + Number(rule.minutes ?? 0) * 60
    + Number(rule.hours ?? 0) * 3600
    + Number(rule.days ?? 0) * 86400;
  if (!Number.isFinite(seconds) || !Number.isInteger(seconds) || seconds <= 0) {
    throw validationError(`Time rule has invalid duration: ${rule.id || 'unknown'}`);
  }
  return seconds;
}

function mergeRulePack(defaults = {}, override = {}) {
  const output = {};
  const keys = new Set([...Object.keys(defaults || {}), ...Object.keys(override || {})]);
  for (const key of keys) {
    output[key] = Array.isArray(override?.[key])
      ? override[key]
      : (Array.isArray(defaults?.[key]) ? defaults[key] : []);
  }
  return output;
}

function parseJsonObject(content) {
  try {
    return parseFirstJsonObject(content);
  } catch {
    throw validationError('LLM time interpretation did not return a JSON object');
  }
}

function safeCall(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function normalizeDurationSeconds(input = {}) {
  const seconds = Number(input.seconds ?? 0)
    + Number(input.minutes ?? 0) * 60
    + Number(input.hours ?? 0) * 3600
    + Number(input.days ?? 0) * 86400;
  const amount = input.amount === undefined ? 0 : Number(input.amount);
  const unitSeconds = amount ? amount * unitToSeconds(input.unit || 'seconds') : 0;
  const total = seconds + unitSeconds;
  if (!Number.isFinite(total) || !Number.isInteger(total)) throw validationError('duration must resolve to an integer number of seconds');
  return total;
}

function normalizeOptionalDurationSeconds(input = {}) {
  if (
    input.afterSeconds === undefined
    && input.afterMinutes === undefined
    && input.afterHours === undefined
    && input.afterDays === undefined
  ) return undefined;
  const total = Number(input.afterSeconds ?? 0)
    + Number(input.afterMinutes ?? 0) * 60
    + Number(input.afterHours ?? 0) * 3600
    + Number(input.afterDays ?? 0) * 86400;
  if (!Number.isFinite(total) || !Number.isInteger(total)) throw validationError('event delay must resolve to integer seconds');
  return total;
}

function unitToSeconds(unit) {
  const normalized = String(unit || 'seconds').toLowerCase();
  if (['second', 'seconds', 'sec', 's'].includes(normalized)) return 1;
  if (['minute', 'minutes', 'min', 'm'].includes(normalized)) return 60;
  if (['hour', 'hours', 'h'].includes(normalized)) return 3600;
  if (['day', 'days', 'd'].includes(normalized)) return 86400;
  if (['round', 'rounds'].includes(normalized)) return DEFAULT_ROUND_SECONDS;
  throw validationError(`Unsupported time unit: ${unit}`);
}

function sortTurnRecords(records) {
  return [...records].sort((left, right) => {
    const initiativeDelta = Number(right.initiative || 0) - Number(left.initiative || 0);
    if (initiativeDelta) return initiativeDelta;
    const dexDelta = Number(right.dexterityModifier || 0) - Number(left.dexterityModifier || 0);
    if (dexDelta) return dexDelta;
    const orderDelta = Number(left.orderIndex || 0) - Number(right.orderIndex || 0);
    if (orderDelta) return orderDelta;
    return String(left.name || left.participantId).localeCompare(String(right.name || right.participantId));
  });
}

function normalizeTurnIndex(turnIndex, currentParticipantId, order) {
  const explicit = Number(turnIndex);
  if (Number.isInteger(explicit) && explicit >= 0 && explicit < order.length) return explicit;
  const matched = order.findIndex((record) => record.data.participantId === currentParticipantId);
  return matched >= 0 ? matched : 0;
}

function defaultActionState(existing = {}) {
  const current = normalizeObject(existing);
  return {
    action: true,
    bonusAction: true,
    reaction: current.reaction ?? true,
    movementRemaining: current.movementRemaining ?? 30,
    ...current
  };
}

function endActionState(existing = {}) {
  return {
    ...normalizeObject(existing),
    action: false,
    bonusAction: false,
    movementRemaining: 0
  };
}

function effectShouldTick(effect, timing, participantId) {
  const tickTiming = String(effect.tickTiming || 'endRound');
  if (timing === 'endRound') return ['endRound', 'round'].includes(tickTiming);
  if (timing === 'startTurn') {
    return tickTiming === 'startTurn' && (!effect.targetParticipantId || effect.targetParticipantId === participantId || effect.ownerParticipantId === participantId);
  }
  if (timing === 'endTurn') {
    return tickTiming === 'endTurn' && (!effect.targetParticipantId || effect.targetParticipantId === participantId || effect.ownerParticipantId === participantId);
  }
  return false;
}

function normalizeImportRecords(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function clockRecordId(clockId) {
  return `timeclock_${safeSegment(clockId || DEFAULT_CLOCK_ID)}`;
}

function interpreterSettingsId(settingsId) {
  return `timeinterp_${safeSegment(settingsId || DEFAULT_SETTINGS_ID)}`;
}

function worldClockRecordId(worldClockId) {
  return `timeworldclock_${safeSegment(worldClockId || DEFAULT_WORLD_CLOCK_ID)}`;
}

function turnOrderId(encounterId, participantId) {
  return `turn_${safeSegment(encounterId)}_${safeSegment(participantId)}`.slice(0, 128);
}

function normalizeEncounterId(value) {
  const text = normalizeRequiredText(value, 'encounterId');
  return safeSegment(text) || `encounter_${shortHash(text)}`;
}

function normalizeParticipantId(value) {
  const text = normalizeRequiredText(value, 'participantId');
  return safeSegment(text) || `participant_${shortHash(text)}`;
}

function normalizeEffectId(value) {
  const text = normalizeRequiredText(value, 'effectId');
  return safeSegment(text) || `effect_${shortHash(text)}`;
}

function normalizeEventId(value) {
  const text = normalizeRequiredText(value, 'eventId');
  return safeSegment(text) || `event_${shortHash(text)}`;
}

function normalizeWorldClockId(value) {
  const text = normalizeOptionalText(value) || DEFAULT_WORLD_CLOCK_ID;
  return safeSegment(text) || `worldclock_${shortHash(text)}`;
}

function normalizeSceneId(value) {
  return normalizeOptionalText(value) || DEFAULT_SCENE_ID;
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeNumericObject(value) {
  const object = normalizeObject(value);
  const output = {};
  for (const [key, raw] of Object.entries(object)) {
    if (raw === null || raw === undefined || raw === '') continue;
    const number = Number(raw);
    if (!Number.isFinite(number)) throw validationError(`Numeric effect value must be finite: ${key}`);
    output[safeFieldName(key)] = number;
  }
  return output;
}

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return (Array.isArray(value) ? value : [value])
    .flatMap((item) => typeof item === 'string' ? item.split(',') : [item])
    .map((item) => String(item).trim())
    .filter(Boolean);
}

function normalizeRequiredText(value, field) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) throw validationError(`${field} is required`);
  return normalized;
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeSearchText(value) {
  return String(value || '').normalize('NFKC').toLowerCase();
}

function normalizeInteger(value, field) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number)) throw validationError(`${field} must be an integer`);
  return number;
}

function normalizeNonNegativeInteger(value, field) {
  const number = normalizeInteger(value, field);
  if (number < 0) throw validationError(`${field} must be >= 0`);
  return number;
}

function normalizePositiveInteger(value, field) {
  const number = normalizeInteger(value, field);
  if (number <= 0) throw validationError(`${field} must be > 0`);
  return number;
}

function normalizeNumber(value, field) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) throw validationError(`${field} must be a finite number`);
  return number;
}

function normalizePositiveNumber(value, field) {
  const number = normalizeNumber(value, field);
  if (number <= 0) throw validationError(`${field} must be > 0`);
  return number;
}

function normalizeBooleanInteger(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return 1;
  if (value === false || value === 0 || value === '0' || value === 'false') return 0;
  return value ? 1 : 0;
}

function normalizeProbability(value, field) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw validationError(`${field} must be a number between 0 and 1`);
  }
  return number;
}

function safeFieldName(value) {
  const field = safeSegment(value);
  if (!field) throw validationError('field name is required');
  return field;
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
  error.name = 'TimeTurnValidationError';
  error.statusCode = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.name = 'TimeTurnNotFoundError';
  error.statusCode = 404;
  return error;
}

function shortHash(value) {
  let hash = 0x811c9dc5;
  const text = String(value || 'time');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
