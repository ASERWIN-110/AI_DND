// @ts-nocheck
import YAML from 'yaml';
import { documentToCollections, parseStructuredDocument } from '../data/structured-document-importer.js';
import { StructuredInterfaceTraceRecorder } from '../structured/structured-interface.js';
import { createId } from '../utils/id.js';
import { parseFirstJsonObject } from '../utils/json.js';

export const QUEST_RECORDS_COLLECTION = 'quest_records';
export const QUEST_EVENTS_COLLECTION = 'quest_events';
export const QUEST_CLOCKS_COLLECTION = 'quest_clocks';

export const QUEST_RECORD_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id. Duplicated for readable exports.' },
  { name: 'questId', type: 'text', description: 'Stable quest id inside one chat.' },
  { name: 'title', type: 'text', description: 'Human-readable quest title or rumor label.' },
  { name: 'status', type: 'text', description: 'rumor, tracked, dormant, reportable, completed, failed, expired, abandoned, or archived.' },
  { name: 'hookText', type: 'text', description: 'Player-facing rumor or quest introduction.' },
  { name: 'objective', type: 'text', description: 'Outcome-focused objective. This is not a required route chain.' },
  { name: 'successCriteria', type: 'json', description: 'One to three outcome criteria that can prove success without prescribing a route.' },
  { name: 'evidenceSlots', type: 'json', description: 'Open evidence slots for investigation convergence.' },
  { name: 'knownFacts', type: 'json', description: 'Confirmed facts discovered during play.' },
  { name: 'suspectedFacts', type: 'json', description: 'Hypotheses or unconfirmed clues.' },
  { name: 'openLeads', type: 'json', description: 'Optional leads. These are hints, not mandatory steps.' },
  { name: 'stakeholders', type: 'json', description: 'NPC, faction, or place references that may care about this quest.' },
  { name: 'locations', type: 'json', description: 'Related location ids or labels.' },
  { name: 'difficultyHint', type: 'text', description: 'Narrative difficulty label or GM note.' },
  { name: 'riskHint', type: 'text', description: 'Narrative risk label or GM note.' },
  { name: 'rewardHints', type: 'json', description: 'Likely reward sources or reward styles.' },
  { name: 'failureImpact', type: 'json', description: 'Likely consequences if the quest expires or fails.' },
  { name: 'expiry', type: 'json', description: 'Quest deadline settings or narrative expiry notes.' },
  { name: 'resolutionPressure', type: 'text', description: 'none, low, medium, high, or forceCheck.' },
  { name: 'investigationBudget', type: 'integer', description: 'Maximum relevant investigation ticks before the quest must converge.' },
  { name: 'budgetRemaining', type: 'integer', description: 'Remaining relevant investigation ticks.' },
  { name: 'deadEndCount', type: 'integer', description: 'Number of non-progressing investigation ticks.' },
  { name: 'mustConcludeAt', type: 'integer', description: 'Convergence threshold used by the GM prompt.' },
  { name: 'antiRailroadRules', type: 'json', description: 'Editable anti-railroad constraints injected into quest prompts.' },
  { name: 'metadata', type: 'json', description: 'Extra quest metadata.' },
  { name: 'createdAtIso', type: 'text', description: 'Creation timestamp.' },
  { name: 'questUpdatedAt', type: 'text', description: 'Latest quest update timestamp.' }
];

export const QUEST_EVENT_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id.' },
  { name: 'eventId', type: 'text', description: 'Stable event id.' },
  { name: 'questId', type: 'text', description: 'Owning quest id.' },
  { name: 'eventType', type: 'text', description: 'hook, track, investigation_tick, completion_check, reward, consequence, expired, status, note, etc.' },
  { name: 'sourceText', type: 'text', description: 'Raw player/GM/action text that caused this event.' },
  { name: 'summary', type: 'text', description: 'Short event summary.' },
  { name: 'linkedActionId', type: 'text', description: 'Optional action resolver id.' },
  { name: 'linkedSceneId', type: 'text', description: 'Optional scene id.' },
  { name: 'linkedNpcIds', type: 'json', description: 'Optional NPC references.' },
  { name: 'linkedFactionIds', type: 'json', description: 'Optional faction references.' },
  { name: 'evidenceUpdates', type: 'json', description: 'Evidence slot changes caused by this event.' },
  { name: 'pressureDelta', type: 'integer', description: 'Resolution pressure adjustment.' },
  { name: 'budgetSpent', type: 'integer', description: 'Relevant investigation budget spent by this event.' },
  { name: 'tickType', type: 'text', description: 'evidence, exclusion, risk, conclusion, or blank for non-investigation events.' },
  { name: 'metadata', type: 'json', description: 'Extra event metadata.' },
  { name: 'createdAtIso', type: 'text', description: 'Event timestamp.' }
];

export const QUEST_CLOCK_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id.' },
  { name: 'questId', type: 'text', description: 'Owning quest id.' },
  { name: 'status', type: 'text', description: 'active, paused, resolved, or archived.' },
  { name: 'expiresAtElapsedSeconds', type: 'integer', description: 'Due when the chat clock elapsed seconds reaches this value.' },
  { name: 'expiresAtRound', type: 'integer', description: 'Due when the active encounter round reaches this value.' },
  { name: 'expiresAtSceneEnd', type: 'integer', description: 'Boolean 0/1 flag: due when current scene ends.' },
  { name: 'expireMode', type: 'text', description: 'fail, expire, abandon, or custom.' },
  { name: 'expiryImpact', type: 'json', description: 'Consequences to consider when the quest expires.' },
  { name: 'createdAtIso', type: 'text', description: 'Clock creation timestamp.' },
  { name: 'clockUpdatedAt', type: 'text', description: 'Latest clock update timestamp.' }
];

export const QUEST_STATUSES = new Set([
  'rumor',
  'tracked',
  'dormant',
  'reportable',
  'completed',
  'failed',
  'expired',
  'abandoned',
  'archived'
]);

export const ACTIVE_QUEST_STATUSES = new Set(['rumor', 'tracked', 'dormant', 'reportable']);
export const INVESTIGATION_TICK_TYPES = new Set(['evidence', 'exclusion', 'risk', 'conclusion']);
export const RESOLUTION_PRESSURE = ['none', 'low', 'medium', 'high', 'forceCheck'];

export const FORBIDDEN_ROUTE_FIELDS = new Set([
  'requiredsteps',
  'stepchain',
  'mandatoryroute',
  'musttalkto',
  'mustvisit',
  'fetchchain',
  'requirednpc',
  'requirednpcs',
  'requiredlocation',
  'requiredlocations',
  'requiredpath',
  'nextrequiredstep'
]);

export const DEFAULT_ANTI_RAILROAD_RULES = [
  'Quest records describe a solvable problem, not a fixed route.',
  'Do not require A -> B -> C -> D travel chains. Store optional openLeads only as hints.',
  'Every relevant investigation tick must be one of: evidence, exclusion, risk, conclusion.',
  'Do not extend an investigation by inventing more doors, rooms, corridors, or stones unless it fills an evidence slot, excludes a possibility, adds a meaningful risk, or concludes the quest.',
  'When required evidence is filled or the investigation budget is exhausted, make the quest reportable, completed, failed, or clearly risky instead of endlessly expanding.'
];

export const QUEST_PROMPT_TEMPLATES = {
  hook: {
    id: 'quest_hook_problem_first',
    description: 'Create a rumor and objective without route chains.',
    outputShape: {
      questId: 'stable_id',
      title: 'short title',
      hookText: 'player-facing rumor or discovery',
      objective: 'outcome to achieve',
      successCriteria: ['1-3 route-free criteria'],
      evidenceSlots: [{ id: 'slot_id', description: 'what would prove progress', required: true }],
      openLeads: ['optional hint, never a mandatory step'],
      investigationBudget: 3
    }
  },
  investigationTick: {
    id: 'investigation_convergence_tick',
    description: 'Force relevant exploration to produce evidence, exclusion, risk, or conclusion.',
    outputShape: {
      tickType: 'evidence|exclusion|risk|conclusion',
      summary: 'what changed',
      evidenceUpdates: [{ slotId: 'slot_id', status: 'filled|partial|excluded', value: 'fact' }],
      budgetSpent: 1,
      mustConcludeNow: false,
      questStatus: 'tracked|reportable|completed|failed'
    }
  },
  completion: {
    id: 'quest_completion_check',
    description: 'Judge whether a player approach achieved the objective, not whether they followed a path.',
    outputShape: {
      objectiveSatisfied: true,
      status: 'completed|failed|reportable|tracked',
      reason: 'short reason',
      satisfiedCriteria: ['criterion id or text'],
      rewardEligible: true
    }
  }
};

export class QuestManager {
  constructor({
    appDatabase,
    collections = {},
    trace,
    traceRecorder,
    chatProvider,
    cwd = process.cwd(),
    now
  } = {}) {
    if (!appDatabase) throw validationError('QuestManager requires appDatabase');
    this.appDatabase = appDatabase;
    this.collections = {
      records: collections.records || QUEST_RECORDS_COLLECTION,
      events: collections.events || QUEST_EVENTS_COLLECTION,
      clocks: collections.clocks || QUEST_CLOCKS_COLLECTION
    };
    this.chatProvider = chatProvider;
    this.now = now || (() => new Date().toISOString());
    this.traceRecorder = traceRecorder || new StructuredInterfaceTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      directory: trace?.directory || 'data/quest-traces',
      cwd,
      now: this.now
    });
  }

  ensureCollections(chatSessionId) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const database = this.appDatabase.ensureChatDataDatabase(normalizedChatSessionId);
    const manager = this.appDatabase.openChatDataManagerByChatId(normalizedChatSessionId);
    const specs = [
      [this.collections.records, QUEST_RECORD_FIELDS, 'quests:records'],
      [this.collections.events, QUEST_EVENT_FIELDS, 'quests:events'],
      [this.collections.clocks, QUEST_CLOCK_FIELDS, 'quests:clocks']
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
    return {
      ...this.ensureCollections(chatSessionId),
      statuses: [...QUEST_STATUSES],
      activeStatuses: [...ACTIVE_QUEST_STATUSES],
      investigationTickTypes: [...INVESTIGATION_TICK_TYPES],
      forbiddenRouteFields: [...FORBIDDEN_ROUTE_FIELDS],
      antiRailroadRules: DEFAULT_ANTI_RAILROAD_RULES,
      templates: QUEST_PROMPT_TEMPLATES
    };
  }

  upsertQuest(input = {}) {
    return this.withTrace('quest-upsert', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const { manager } = this.openManager(chatSessionId);
      const existing = findExistingQuest(manager, this.collections.records, input);
      const quest = normalizeQuestRecord(input, {
        chatSessionId,
        existing: existing?.data,
        now: this.now
      });
      return {
        quest: manager.upsertRecord(this.collections.records, quest, { id: questRecordId(quest.questId) })
      };
    });
  }

  patchQuest(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const current = this.getQuest({ chatSessionId, questId: input.questId, id: input.id });
    return this.upsertQuest({
      ...current.data,
      ...normalizeObject(input.patch || input.update || {}),
      id: current.id,
      chatSessionId,
      questId: current.data.questId
    });
  }

  getQuest({ chatSessionId, questId, id, missing = 'throw' } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    if (id) return manager.getRecord(this.collections.records, id, { missing });
    const normalizedQuestId = normalizeRequiredText(questId, 'questId');
    const record = manager.getRecord(this.collections.records, questRecordId(normalizedQuestId), { missing: 'undefined' });
    if (record) return record;
    const matches = manager.queryRecords(this.collections.records, {
      filter: { questId: normalizedQuestId },
      limit: 2
    }).records;
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw validationError(`Multiple quests matched questId: ${normalizedQuestId}; use id`);
    if (missing === 'undefined') return undefined;
    throw notFound(`Quest not found: ${normalizedQuestId}`);
  }

  listQuests({
    chatSessionId,
    status,
    activeOnly = false,
    query = '',
    filter = {},
    sort = [{ field: 'questUpdatedAt', direction: 'desc' }],
    limit = 100,
    offset = 0
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    const mergedFilter = { ...filter };
    if (typeof status === 'string' && status) mergedFilter.status = normalizeQuestStatus(status);
    const result = manager.queryRecords(this.collections.records, {
      filter: mergedFilter,
      sort,
      limit,
      offset
    });
    const statuses = Array.isArray(status) ? new Set(status.map(normalizeQuestStatus)) : undefined;
    const normalizedQuery = normalizeSearchText(query);
    const records = result.records.filter((record) => {
      const data = record.data || {};
      if (statuses && !statuses.has(data.status)) return false;
      if (activeOnly && !ACTIVE_QUEST_STATUSES.has(data.status)) return false;
      if (!normalizedQuery) return true;
      return normalizeSearchText([
        record.id,
        data.questId,
        data.title,
        data.status,
        data.hookText,
        data.objective,
        JSON.stringify(data.successCriteria || []),
        JSON.stringify(data.openLeads || [])
      ].filter(Boolean).join(' ')).includes(normalizedQuery);
    });
    return {
      ...result,
      chatSessionId: normalizedChatSessionId,
      records
    };
  }

  trackQuest(input = {}) {
    return this.withTrace('quest-track', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const quest = this.getQuest({ chatSessionId, questId: input.questId, id: input.id });
      const status = normalizeQuestStatus(input.status || 'tracked');
      const updated = this.upsertQuest({
        ...quest.data,
        chatSessionId,
        status,
        questUpdatedAt: this.now()
      }).quest;
      const event = this.addQuestEvent({
        chatSessionId,
        questId: updated.data.questId,
        eventType: 'track',
        summary: input.summary || `Quest marked ${status}`,
        sourceText: input.sourceText,
        metadata: { source: input.source || 'quest-manager' },
        applyToQuest: false
      }).event;
      return { quest: updated, event };
    });
  }

  setQuestStatus(input = {}) {
    return this.withTrace('quest-set-status', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const status = normalizeQuestStatus(input.status, 'status');
      const quest = this.getQuest({ chatSessionId, questId: input.questId, id: input.id });
      const updated = this.upsertQuest({
        ...quest.data,
        chatSessionId,
        status,
        questUpdatedAt: this.now()
      }).quest;
      const event = this.addQuestEvent({
        chatSessionId,
        questId: updated.data.questId,
        eventType: input.eventType || 'status',
        summary: input.summary || `Quest status set to ${status}`,
        sourceText: input.sourceText,
        metadata: input.metadata,
        applyToQuest: false
      }).event;
      return { quest: updated, event };
    });
  }

  archiveQuest(input = {}) {
    return this.setQuestStatus({
      ...input,
      status: 'archived',
      eventType: 'archive',
      summary: input.summary || 'Quest archived'
    });
  }

  addQuestEvent(input = {}) {
    return this.withTrace('quest-add-event', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const quest = this.getQuest({ chatSessionId, questId: input.questId, id: input.questRecordId });
      const event = normalizeQuestEvent({
        ...input,
        questId: quest.data.questId
      }, {
        chatSessionId,
        now: this.now
      });
      const { manager } = this.openManager(chatSessionId);
      const eventRecord = manager.upsertRecord(this.collections.events, event, {
        id: questEventRecordId(event.questId, event.eventId)
      });
      let updatedQuest = quest;
      if (input.applyToQuest !== false) {
        const nextQuest = applyQuestEventToRecord(quest.data, event, {
          now: this.now,
          autoReportable: input.autoReportable !== false
        });
        updatedQuest = manager.upsertRecord(this.collections.records, nextQuest, {
          id: questRecordId(nextQuest.questId)
        });
      }
      return {
        event: eventRecord,
        quest: updatedQuest
      };
    });
  }

  listEvents({
    chatSessionId,
    questId,
    eventType,
    filter = {},
    sort = [{ field: 'createdAtIso', direction: 'asc' }],
    limit = 200,
    offset = 0
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    const mergedFilter = { ...filter };
    if (questId) mergedFilter.questId = normalizeRequiredText(questId, 'questId');
    if (eventType) mergedFilter.eventType = String(eventType);
    return {
      ...manager.queryRecords(this.collections.events, {
        filter: mergedFilter,
        sort,
        limit,
        offset
      }),
      chatSessionId: normalizedChatSessionId
    };
  }

  setQuestClock(input = {}) {
    return this.withTrace('quest-set-clock', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const questId = normalizeRequiredText(input.questId, 'questId');
      const { manager } = this.openManager(chatSessionId);
      this.getQuest({ chatSessionId, questId });
      const current = manager.getRecord(this.collections.clocks, questClockRecordId(questId), { missing: 'undefined' });
      const clock = normalizeQuestClock(input, {
        chatSessionId,
        existing: current?.data,
        now: this.now
      });
      return {
        clock: manager.upsertRecord(this.collections.clocks, clock, { id: questClockRecordId(clock.questId) })
      };
    });
  }

  expireDueQuests(input = {}) {
    return this.withTrace('quest-expire-due', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const { manager } = this.openManager(chatSessionId);
      const clocks = manager.queryRecords(this.collections.clocks, {
        filter: { status: input.includePaused ? { in: ['active', 'paused'] } : 'active' },
        limit: 500
      }).records;
      const due = clocks.filter((record) => isQuestClockDue(record.data, input));
      const expired = [];
      for (const clockRecord of due) {
        const clock = clockRecord.data;
        const mode = normalizeOptionalText(clock.expireMode) || 'expire';
        const status = mode === 'fail' ? 'failed' : mode === 'abandon' ? 'abandoned' : 'expired';
        const quest = this.getQuest({ chatSessionId, questId: clock.questId, missing: 'undefined' });
        if (!quest || !ACTIVE_QUEST_STATUSES.has(quest.data.status)) {
          manager.upsertRecord(this.collections.clocks, {
            ...clock,
            status: 'resolved',
            clockUpdatedAt: this.now()
          }, { id: clockRecord.id });
          continue;
        }
        const updated = this.setQuestStatus({
          chatSessionId,
          questId: clock.questId,
          status,
          eventType: 'expired',
          summary: input.summary || `Quest deadline reached: ${mode}`,
          metadata: {
            clock: compactClock(clock),
            expiryImpact: clock.expiryImpact,
            source: input.source || 'quest-clock'
          }
        }).quest;
        const updatedClock = manager.upsertRecord(this.collections.clocks, {
          ...clock,
          status: 'resolved',
          clockUpdatedAt: this.now()
        }, { id: clockRecord.id });
        expired.push({ quest: updated, clock: updatedClock });
      }
      return {
        count: expired.length,
        expired
      };
    });
  }

  buildHookPrompt(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    return buildQuestHookPrompt({
      seedText: input.seedText || input.text || input.content || '',
      sceneContext: input.sceneContext || input.context || '',
      userRules: input.userRules || input.rules || '',
      existingQuests: this.listQuests({ chatSessionId, activeOnly: true, limit: 50 }).records.map((record) => record.data)
    });
  }

  async createHook(input = {}, { chatProvider = this.chatProvider } = {}) {
    return this.withTrace('quest-create-hook', input.chatSessionId, input, async () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const prompt = this.buildHookPrompt(input);
      let rawQuest = input.quest || input.hook || input.questRecord;
      let llm = { used: false, reason: rawQuest ? 'quest_supplied' : 'llm_disabled' };
      if (!rawQuest && input.useLlm) {
        const completion = await generateQuestJson({
          chatProvider,
          prompt,
          system: 'You create open-ended tabletop RPG quest hooks. Return JSON only.',
          temperature: input.temperature,
          maxTokens: input.maxTokens || 1200,
          missingMessage: 'Quest hook creation requested LLM, but no chatProvider is available'
        });
        rawQuest = completion.json;
        llm = {
          used: true,
          content: completion.content,
          raw: completion.raw
        };
      }
      if (!rawQuest) rawQuest = defaultQuestHook(input);
      const quest = normalizeQuestRecord({
        ...rawQuest,
        chatSessionId,
        status: rawQuest.status || 'rumor'
      }, {
        chatSessionId,
        now: this.now
      });
      if (input.dryRun === true) {
        return {
          prompt,
          quest,
          llm,
          dryRun: true
        };
      }
      const { manager } = this.openManager(chatSessionId);
      const record = manager.upsertRecord(this.collections.records, quest, { id: questRecordId(quest.questId) });
      const event = manager.upsertRecord(this.collections.events, normalizeQuestEvent({
        chatSessionId,
        questId: quest.questId,
        eventType: 'hook',
        sourceText: input.seedText || input.text || input.content,
        summary: quest.hookText || quest.title,
        metadata: { llm }
      }, { chatSessionId, now: this.now }), {
        id: questEventRecordId(quest.questId, createId('questevent'))
      });
      return {
        prompt,
        quest: record,
        event,
        llm,
        dryRun: false
      };
    });
  }

  buildRelevancePrompt(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const quests = this.listQuests({ chatSessionId, activeOnly: true, limit: input.limit || 100 }).records.map((record) => record.data);
    return buildQuestRelevancePrompt({
      text: input.text || input.sourceText || input.content || '',
      quests,
      sceneContext: input.sceneContext || input.context || '',
      userRules: input.userRules || input.rules || ''
    });
  }

  async gateRelevance(input = {}, { chatProvider = this.chatProvider } = {}) {
    return this.withTrace('quest-gate-relevance', input.chatSessionId, input, async () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const quests = this.listQuests({ chatSessionId, activeOnly: true, limit: input.limit || 100 }).records.map((record) => record.data);
      const prompt = buildQuestRelevancePrompt({
        text: input.text || input.sourceText || input.content || '',
        quests,
        sceneContext: input.sceneContext || input.context || '',
        userRules: input.userRules || input.rules || ''
      });
      let rawDecision = input.decision || input.relevance;
      let llm = { used: false, reason: rawDecision ? 'decision_supplied' : 'rule_based' };
      if (!rawDecision && input.useLlm) {
        const completion = await generateQuestJson({
          chatProvider,
          prompt,
          system: 'You decide which active RPG quests are affected by new text. Return JSON only.',
          temperature: input.temperature,
          maxTokens: input.maxTokens || 900,
          missingMessage: 'Quest relevance gate requested LLM, but no chatProvider is available'
        });
        rawDecision = completion.json;
        llm = { used: true, content: completion.content, raw: completion.raw };
      }
      const decision = normalizeRelevanceDecision(rawDecision || ruleBasedQuestRelevance(input, quests), quests);
      return {
        prompt,
        decision,
        quests: decision.questIds.map((questId) => quests.find((quest) => quest.questId === questId)).filter(Boolean),
        llm
      };
    });
  }

  buildInvestigationPrompt(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const quest = this.getQuest({ chatSessionId, questId: input.questId, id: input.id }).data;
    return buildInvestigationTickPrompt({
      quest,
      sourceText: input.sourceText || input.text || input.content || '',
      sceneContext: input.sceneContext || input.context || '',
      recentEvents: this.listEvents({ chatSessionId, questId: quest.questId, limit: input.eventLimit || 20 }).records.map((record) => record.data),
      userRules: input.userRules || input.rules || ''
    });
  }

  async resolveInvestigationTick(input = {}, { chatProvider = this.chatProvider } = {}) {
    return this.withTrace('quest-investigation-tick', input.chatSessionId, input, async () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const questRecord = this.getQuest({ chatSessionId, questId: input.questId, id: input.id });
      const quest = questRecord.data;
      const prompt = buildInvestigationTickPrompt({
        quest,
        sourceText: input.sourceText || input.text || input.content || '',
        sceneContext: input.sceneContext || input.context || '',
        recentEvents: this.listEvents({ chatSessionId, questId: quest.questId, limit: input.eventLimit || 20 }).records.map((record) => record.data),
        userRules: input.userRules || input.rules || ''
      });
      let rawTick = input.tick || input.decision;
      let llm = { used: false, reason: rawTick ? 'tick_supplied' : 'template' };
      if (!rawTick && input.useLlm) {
        const completion = await generateQuestJson({
          chatProvider,
          prompt,
          system: 'You resolve one investigation tick for an open-ended RPG quest. Return JSON only.',
          temperature: input.temperature,
          maxTokens: input.maxTokens || 1200,
          missingMessage: 'Quest investigation tick requested LLM, but no chatProvider is available'
        });
        rawTick = completion.json;
        llm = { used: true, content: completion.content, raw: completion.raw };
      }
      const tick = normalizeInvestigationTick(rawTick || defaultInvestigationTick(quest), {
        quest,
        sourceText: input.sourceText || input.text || input.content || ''
      });
      if (input.dryRun !== false) {
        return {
          prompt,
          quest: questRecord,
          tick,
          llm,
          dryRun: true
        };
      }
      const eventResult = this.addQuestEvent({
        chatSessionId,
        questId: quest.questId,
        eventType: 'investigation_tick',
        sourceText: input.sourceText || input.text || input.content,
        summary: tick.summary,
        linkedActionId: input.linkedActionId,
        linkedSceneId: input.linkedSceneId || input.sceneId,
        linkedNpcIds: tick.linkedNpcIds || input.linkedNpcIds,
        linkedFactionIds: tick.linkedFactionIds || input.linkedFactionIds,
        evidenceUpdates: tick.evidenceUpdates,
        pressureDelta: tick.pressureDelta,
        budgetSpent: tick.budgetSpent,
        tickType: tick.tickType,
        metadata: {
          ...tick.metadata,
          questStatus: tick.questStatus,
          mustConcludeNow: tick.mustConcludeNow,
          llm
        }
      });
      let questAfter = eventResult.quest;
      if (tick.questStatus) {
        questAfter = this.setQuestStatus({
          chatSessionId,
          questId: quest.questId,
          status: tick.questStatus,
          eventType: 'investigation_status',
          summary: `Investigation tick set quest ${tick.questStatus}`,
          metadata: { tickType: tick.tickType }
        }).quest;
      }
      return {
        prompt,
        questBefore: questRecord,
        tick,
        event: eventResult.event,
        quest: questAfter,
        llm,
        dryRun: false
      };
    });
  }

  buildCompletionPrompt(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const quest = this.getQuest({ chatSessionId, questId: input.questId, id: input.id }).data;
    return buildQuestCompletionPrompt({
      quest,
      sourceText: input.sourceText || input.text || input.content || '',
      sceneContext: input.sceneContext || input.context || '',
      recentEvents: this.listEvents({ chatSessionId, questId: quest.questId, limit: input.eventLimit || 20 }).records.map((record) => record.data),
      userRules: input.userRules || input.rules || ''
    });
  }

  async checkCompletion(input = {}, { chatProvider = this.chatProvider } = {}) {
    return this.withTrace('quest-completion-check', input.chatSessionId, input, async () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const questRecord = this.getQuest({ chatSessionId, questId: input.questId, id: input.id });
      const quest = questRecord.data;
      const prompt = buildQuestCompletionPrompt({
        quest,
        sourceText: input.sourceText || input.text || input.content || '',
        sceneContext: input.sceneContext || input.context || '',
        recentEvents: this.listEvents({ chatSessionId, questId: quest.questId, limit: input.eventLimit || 20 }).records.map((record) => record.data),
        userRules: input.userRules || input.rules || ''
      });
      let rawDecision = input.decision || input.completion;
      let llm = { used: false, reason: rawDecision ? 'decision_supplied' : 'template' };
      if (!rawDecision && input.useLlm) {
        const completion = await generateQuestJson({
          chatProvider,
          prompt,
          system: 'You judge whether an open-ended RPG quest objective was achieved. Return JSON only.',
          temperature: input.temperature,
          maxTokens: input.maxTokens || 1200,
          missingMessage: 'Quest completion check requested LLM, but no chatProvider is available'
        });
        rawDecision = completion.json;
        llm = { used: true, content: completion.content, raw: completion.raw };
      }
      const decision = normalizeCompletionDecision(rawDecision || defaultCompletionDecision(quest), quest);
      if (input.dryRun !== false) {
        return {
          prompt,
          quest: questRecord,
          decision,
          llm,
          dryRun: true
        };
      }
      const eventResult = this.addQuestEvent({
        chatSessionId,
        questId: quest.questId,
        eventType: 'completion_check',
        sourceText: input.sourceText || input.text || input.content,
        summary: decision.reason,
        evidenceUpdates: decision.evidenceUpdates,
        metadata: {
          objectiveSatisfied: decision.objectiveSatisfied,
          satisfiedCriteria: decision.satisfiedCriteria,
          rewardEligible: decision.rewardEligible,
          llm
        }
      });
      let questAfter = eventResult.quest;
      if (decision.status && decision.status !== questAfter.data.status) {
        questAfter = this.setQuestStatus({
          chatSessionId,
          questId: quest.questId,
          status: decision.status,
          eventType: 'completion_status',
          summary: `Completion check set quest ${decision.status}`,
          metadata: { objectiveSatisfied: decision.objectiveSatisfied }
        }).quest;
      }
      return {
        prompt,
        questBefore: questRecord,
        decision,
        event: eventResult.event,
        quest: questAfter,
        llm,
        dryRun: false
      };
    });
  }

  async planReward(input = {}, { chatProvider = this.chatProvider } = {}) {
    return this.withTrace('quest-plan-reward', input.chatSessionId, input, async () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const quest = this.getQuest({ chatSessionId, questId: input.questId, id: input.id }).data;
      const prompt = buildRewardPrompt({
        quest,
        completion: input.completion || input.decision || {},
        processSummary: input.processSummary || input.sourceText || '',
        userRules: input.userRules || input.rules || ''
      });
      let rawPlan = input.rewardPlan || input.plan;
      let llm = { used: false, reason: rawPlan ? 'plan_supplied' : 'template' };
      if (!rawPlan && input.useLlm) {
        const completion = await generateQuestJson({
          chatProvider,
          prompt,
          system: 'You plan fair tabletop RPG quest rewards from outcome, risk, process, and patron resources. Return JSON only.',
          temperature: input.temperature,
          maxTokens: input.maxTokens || 1000,
          missingMessage: 'Quest reward planning requested LLM, but no chatProvider is available'
        });
        rawPlan = completion.json;
        llm = { used: true, content: completion.content, raw: completion.raw };
      }
      const rewardPlan = normalizeRewardPlan(rawPlan || defaultRewardPlan(quest), quest);
      return {
        prompt,
        quest,
        rewardPlan,
        llm
      };
    });
  }

  async planConsequence(input = {}, { chatProvider = this.chatProvider } = {}) {
    return this.withTrace('quest-plan-consequence', input.chatSessionId, input, async () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const quest = this.getQuest({ chatSessionId, questId: input.questId, id: input.id }).data;
      const prompt = buildConsequencePrompt({
        quest,
        failureOrExpiry: input.failureOrExpiry || input.event || {},
        userRules: input.userRules || input.rules || ''
      });
      let rawPlan = input.consequencePlan || input.plan;
      let llm = { used: false, reason: rawPlan ? 'plan_supplied' : 'template' };
      if (!rawPlan && input.useLlm) {
        const completion = await generateQuestJson({
          chatProvider,
          prompt,
          system: 'You plan tabletop RPG quest consequences from failure, expiry, and ignored hooks. Return JSON only.',
          temperature: input.temperature,
          maxTokens: input.maxTokens || 1000,
          missingMessage: 'Quest consequence planning requested LLM, but no chatProvider is available'
        });
        rawPlan = completion.json;
        llm = { used: true, content: completion.content, raw: completion.raw };
      }
      const consequencePlan = normalizeConsequencePlan(rawPlan || defaultConsequencePlan(quest), quest);
      return {
        prompt,
        quest,
        consequencePlan,
        llm
      };
    });
  }

  importQuests(input = {}) {
    return this.withTrace('quest-import', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const { manager } = this.openManager(chatSessionId);
      const parsed = parseStructuredDocument(input);
      const data = parsed.data?.questSystem || parsed.data?.quests || parsed.data || {};
      const directGroups = [
        { collection: this.collections.records, records: normalizeImportRecords(data.records || data.questRecords || data.quests) },
        { collection: this.collections.events, records: normalizeImportRecords(data.events || data.questEvents) },
        { collection: this.collections.clocks, records: normalizeImportRecords(data.clocks || data.questClocks) }
      ];
      const hasQuestShape = directGroups.some((group) => group.records.length);
      const groups = hasQuestShape
        ? directGroups
        : documentToCollections({
          data,
          collection: input.collection,
          collectionMap: {
            records: this.collections.records,
            quests: this.collections.records,
            questRecords: this.collections.records,
            events: this.collections.events,
            questEvents: this.collections.events,
            clocks: this.collections.clocks,
            questClocks: this.collections.clocks,
            ...(input.collectionMap || {})
          },
          idField: input.idField || 'id'
        });
      const imported = [];
      for (const group of groups.filter((candidate) => candidate.records?.length)) {
        for (const rawRecord of group.records) {
          if (group.collection === this.collections.records) {
            const { id, ...record } = rawRecord;
            const quest = normalizeQuestRecord({ ...record, chatSessionId }, { chatSessionId, now: this.now });
            imported.push(manager.upsertRecord(this.collections.records, quest, { id: id || questRecordId(quest.questId) }));
          } else if (group.collection === this.collections.events) {
            const { id, ...record } = rawRecord;
            const event = normalizeQuestEvent({ ...record, chatSessionId }, { chatSessionId, now: this.now });
            imported.push(manager.upsertRecord(this.collections.events, event, { id: id || questEventRecordId(event.questId, event.eventId) }));
          } else if (group.collection === this.collections.clocks) {
            const { id, ...record } = rawRecord;
            const clock = normalizeQuestClock({ ...record, chatSessionId }, { chatSessionId, now: this.now });
            imported.push(manager.upsertRecord(this.collections.clocks, clock, { id: id || questClockRecordId(clock.questId) }));
          }
        }
      }
      return {
        format: parsed.format,
        count: imported.length,
        records: imported
      };
    });
  }

  exportQuests({
    chatSessionId,
    format = 'json',
    includeEvents = true,
    includeClocks = true,
    status,
    activeOnly = false
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const quests = this.listQuests({
      chatSessionId: normalizedChatSessionId,
      status,
      activeOnly,
      limit: 500
    }).records;
    const questIds = new Set(quests.map((record) => record.data.questId));
    const { manager } = this.openManager(normalizedChatSessionId);
    const payload = {
      questSystem: {
        records: quests.map(exportRecordData)
      }
    };
    if (includeEvents) {
      payload.questSystem.events = manager.queryRecords(this.collections.events, {
        limit: 500,
        sort: [{ field: 'createdAtIso', direction: 'asc' }]
      }).records.filter((record) => questIds.has(record.data.questId)).map(exportRecordData);
    }
    if (includeClocks) {
      payload.questSystem.clocks = manager.queryRecords(this.collections.clocks, { limit: 500 })
        .records.filter((record) => questIds.has(record.data.questId)).map(exportRecordData);
    }
    const resolvedFormat = String(format || 'json').toLowerCase();
    if (resolvedFormat === 'json') {
      return {
        format: 'json',
        text: JSON.stringify(payload, null, 2),
        payload
      };
    }
    if (resolvedFormat === 'yaml' || resolvedFormat === 'yml') {
      return {
        format: 'yaml',
        text: YAML.stringify(payload),
        payload
      };
    }
    throw validationError('export format must be json or yaml');
  }

  questSnapshot({ chatSessionId } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    return {
      chatSessionId: normalizedChatSessionId,
      quests: manager.queryRecords(this.collections.records, { limit: 500 }).records.map((record) => ({ id: record.id, ...record.data })),
      events: manager.queryRecords(this.collections.events, { limit: 500 }).records.map((record) => ({ id: record.id, ...record.data })),
      clocks: manager.queryRecords(this.collections.clocks, { limit: 500 }).records.map((record) => ({ id: record.id, ...record.data }))
    };
  }

  withTrace(operation, chatSessionId, input, fn) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const before = this.questSnapshot({ chatSessionId: normalizedChatSessionId });
    const trace = this.traceRecorder.start(operation, {
      sessionId: normalizedChatSessionId,
      input,
      stateBefore: before
    });
    const finish = (output) => {
      const after = this.questSnapshot({ chatSessionId: normalizedChatSessionId });
      return {
        ...output,
        trace: this.traceRecorder.finish(trace, {
          output,
          stateAfter: after,
          prompt: output?.prompt
        })
      };
    };
    try {
      const output = fn();
      if (output && typeof output.then === 'function') {
        return output.then(finish).catch((error) => {
          this.traceRecorder.fail(trace, { error });
          throw error;
        });
      }
      return finish(output);
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

export function normalizeQuestRecord(input = {}, { chatSessionId, existing = {}, now = () => new Date().toISOString() } = {}) {
  assertNoForbiddenRouteFields(input);
  const timestamp = now();
  const title = normalizeOptionalText(input.title || existing.title) || 'Untitled Quest';
  const questId = normalizeOptionalText(input.questId || input.id || existing.questId) || slugId(title, 'quest');
  const investigationBudget = normalizeNonNegativeInteger(
    input.investigationBudget ?? existing.investigationBudget ?? defaultInvestigationBudget(input),
    'investigationBudget'
  );
  const budgetRemaining = normalizeNonNegativeInteger(
    input.budgetRemaining ?? existing.budgetRemaining ?? investigationBudget,
    'budgetRemaining'
  );
  const evidenceSlots = normalizeEvidenceSlots(input.evidenceSlots ?? existing.evidenceSlots);
  const quest = {
    chatSessionId: normalizeRequiredText(input.chatSessionId || chatSessionId || existing.chatSessionId, 'chatSessionId'),
    questId,
    title,
    status: normalizeQuestStatus(input.status || existing.status || 'rumor'),
    hookText: normalizeOptionalText(input.hookText || input.hook || existing.hookText),
    objective: normalizeOptionalText(input.objective || existing.objective) || title,
    successCriteria: normalizeSuccessCriteria(input.successCriteria ?? input.criteria ?? existing.successCriteria),
    evidenceSlots,
    knownFacts: normalizeStringArray(input.knownFacts ?? existing.knownFacts),
    suspectedFacts: normalizeStringArray(input.suspectedFacts ?? existing.suspectedFacts),
    openLeads: normalizeStringArray(input.openLeads ?? input.leads ?? existing.openLeads),
    stakeholders: normalizeArray(input.stakeholders ?? existing.stakeholders),
    locations: normalizeArray(input.locations ?? existing.locations),
    difficultyHint: normalizeOptionalText(input.difficultyHint ?? existing.difficultyHint),
    riskHint: normalizeOptionalText(input.riskHint ?? existing.riskHint),
    rewardHints: normalizeArray(input.rewardHints ?? input.rewards ?? existing.rewardHints),
    failureImpact: normalizeObject(input.failureImpact ?? existing.failureImpact),
    expiry: normalizeObject(input.expiry ?? existing.expiry),
    resolutionPressure: normalizeResolutionPressure(input.resolutionPressure ?? existing.resolutionPressure ?? 'none'),
    investigationBudget,
    budgetRemaining,
    deadEndCount: normalizeNonNegativeInteger(input.deadEndCount ?? existing.deadEndCount ?? 0, 'deadEndCount'),
    mustConcludeAt: normalizeNonNegativeInteger(input.mustConcludeAt ?? existing.mustConcludeAt ?? investigationBudget, 'mustConcludeAt'),
    antiRailroadRules: normalizeStringArray(input.antiRailroadRules ?? existing.antiRailroadRules ?? DEFAULT_ANTI_RAILROAD_RULES),
    metadata: normalizeObject(input.metadata ?? existing.metadata),
    createdAtIso: normalizeOptionalText(input.createdAtIso || existing.createdAtIso) || timestamp,
    questUpdatedAt: normalizeOptionalText(input.questUpdatedAt) || timestamp
  };
  if (quest.successCriteria.length > 3) {
    quest.successCriteria = quest.successCriteria.slice(0, 3);
  }
  if (quest.evidenceSlots.length === 0) {
    quest.evidenceSlots = [
      {
        id: 'core_evidence',
        description: `Evidence that proves progress toward: ${quest.objective}`,
        required: true,
        status: 'empty',
        value: '',
        notes: []
      }
    ];
  }
  return deriveQuestStatusAfterProgress(quest);
}

export function normalizeQuestEvent(input = {}, { chatSessionId, now = () => new Date().toISOString() } = {}) {
  assertNoForbiddenRouteFields(input);
  const timestamp = now();
  const questId = normalizeRequiredText(input.questId, 'questId');
  return {
    chatSessionId: normalizeRequiredText(input.chatSessionId || chatSessionId, 'chatSessionId'),
    eventId: normalizeOptionalText(input.eventId || input.id) || createId('questevent'),
    questId,
    eventType: normalizeOptionalText(input.eventType || input.type) || 'note',
    sourceText: normalizeOptionalText(input.sourceText || input.text || input.content),
    summary: normalizeOptionalText(input.summary || input.description) || normalizeOptionalText(input.sourceText) || 'Quest event',
    linkedActionId: normalizeOptionalText(input.linkedActionId),
    linkedSceneId: normalizeOptionalText(input.linkedSceneId || input.sceneId),
    linkedNpcIds: normalizeStringArray(input.linkedNpcIds || input.npcIds),
    linkedFactionIds: normalizeStringArray(input.linkedFactionIds || input.factionIds),
    evidenceUpdates: normalizeEvidenceUpdates(input.evidenceUpdates),
    pressureDelta: normalizeInteger(input.pressureDelta ?? 0, 'pressureDelta'),
    budgetSpent: normalizeNonNegativeInteger(input.budgetSpent ?? 0, 'budgetSpent'),
    tickType: normalizeOptionalTickType(input.tickType),
    metadata: normalizeObject(input.metadata),
    createdAtIso: normalizeOptionalText(input.createdAtIso) || timestamp
  };
}

export function normalizeQuestClock(input = {}, { chatSessionId, existing = {}, now = () => new Date().toISOString() } = {}) {
  const timestamp = now();
  const questId = normalizeRequiredText(input.questId || existing.questId, 'questId');
  return {
    chatSessionId: normalizeRequiredText(input.chatSessionId || chatSessionId || existing.chatSessionId, 'chatSessionId'),
    questId,
    status: normalizeOptionalText(input.status || existing.status) || 'active',
    expiresAtElapsedSeconds: normalizeNullableNonNegativeInteger(input.expiresAtElapsedSeconds ?? existing.expiresAtElapsedSeconds, 'expiresAtElapsedSeconds'),
    expiresAtRound: normalizeNullableNonNegativeInteger(input.expiresAtRound ?? existing.expiresAtRound, 'expiresAtRound'),
    expiresAtSceneEnd: normalizeBooleanInteger(input.expiresAtSceneEnd ?? existing.expiresAtSceneEnd ?? false),
    expireMode: normalizeOptionalText(input.expireMode || existing.expireMode) || 'expire',
    expiryImpact: normalizeObject(input.expiryImpact ?? existing.expiryImpact),
    createdAtIso: normalizeOptionalText(input.createdAtIso || existing.createdAtIso) || timestamp,
    clockUpdatedAt: normalizeOptionalText(input.clockUpdatedAt) || timestamp
  };
}

export function normalizeInvestigationTick(input = {}, { quest, sourceText = '' } = {}) {
  assertNoForbiddenRouteFields(input);
  const tickType = normalizeTickType(input.tickType || input.type || input.kind);
  const budgetSpent = normalizeNonNegativeInteger(input.budgetSpent ?? (tickType === 'conclusion' ? 0 : 1), 'budgetSpent');
  const remaining = Math.max(0, Number(quest?.budgetRemaining || 0) - budgetSpent);
  const mustConcludeNow = Boolean(input.mustConcludeNow || remaining <= 0 || quest?.resolutionPressure === 'forceCheck');
  const normalized = {
    tickType,
    summary: normalizeOptionalText(input.summary || input.reason || input.description) || defaultTickSummary(tickType, sourceText),
    evidenceUpdates: normalizeEvidenceUpdates(input.evidenceUpdates || input.evidence),
    pressureDelta: normalizeInteger(input.pressureDelta ?? (tickType === 'risk' ? 1 : 0), 'pressureDelta'),
    budgetSpent,
    mustConcludeNow,
    questStatus: input.questStatus || input.status ? normalizeQuestStatus(input.questStatus || input.status) : '',
    linkedNpcIds: normalizeStringArray(input.linkedNpcIds || input.npcIds),
    linkedFactionIds: normalizeStringArray(input.linkedFactionIds || input.factionIds),
    metadata: normalizeObject(input.metadata)
  };
  if (mustConcludeNow && !['conclusion', 'risk'].includes(normalized.tickType) && !normalized.questStatus) {
    normalized.metadata.warning = 'Investigation budget is exhausted; next GM output should conclude, mark reportable, fail, or introduce an explicit risk.';
  }
  return normalized;
}

export function normalizeCompletionDecision(input = {}, quest = {}) {
  assertNoForbiddenRouteFields(input);
  const objectiveSatisfied = Boolean(input.objectiveSatisfied ?? input.success ?? false);
  let status = normalizeOptionalText(input.status);
  if (status) status = normalizeQuestStatus(status);
  if (!status && objectiveSatisfied) status = 'completed';
  return {
    objectiveSatisfied,
    status,
    reason: normalizeOptionalText(input.reason || input.summary) || (objectiveSatisfied ? 'Objective satisfied.' : 'Objective not yet satisfied.'),
    satisfiedCriteria: normalizeStringArray(input.satisfiedCriteria || input.criteria),
    evidenceUpdates: normalizeEvidenceUpdates(input.evidenceUpdates),
    rewardEligible: Boolean(input.rewardEligible ?? objectiveSatisfied),
    confidence: clampNumber(input.confidence ?? 0.5, 0, 1),
    metadata: normalizeObject(input.metadata),
    questId: quest.questId
  };
}

export function normalizeRelevanceDecision(input = {}, quests = []) {
  const validQuestIds = new Set(quests.map((quest) => quest.questId));
  const questIds = normalizeStringArray(input.questIds || input.relevantQuestIds || input.quests)
    .filter((questId) => validQuestIds.size === 0 || validQuestIds.has(questId));
  return {
    relevant: Boolean(input.relevant ?? questIds.length > 0),
    questIds,
    ignoredQuestIds: normalizeStringArray(input.ignoredQuestIds),
    shouldCheckCompletion: Boolean(input.shouldCheckCompletion ?? questIds.length > 0),
    shouldResolveInvestigation: Boolean(input.shouldResolveInvestigation ?? questIds.length > 0),
    reason: normalizeOptionalText(input.reason) || (questIds.length ? 'Matched active quest context.' : 'No active quest matched.'),
    confidence: clampNumber(input.confidence ?? (questIds.length ? 0.5 : 0.9), 0, 1)
  };
}

export function buildQuestHookPrompt({ seedText = '', sceneContext = '', existingQuests = [], userRules = '' } = {}) {
  return [
    'Create one open-ended tabletop RPG quest hook.',
    '',
    'Hard rules:',
    ...DEFAULT_ANTI_RAILROAD_RULES.map((rule) => `- ${rule}`),
    '- The quest must have a clear objective and 1-3 successCriteria.',
    '- openLeads are optional hints, not required steps.',
    '- Never output requiredSteps, stepChain, mandatoryRoute, mustTalkTo, mustVisit, fetchChain, requiredNpc, requiredLocation, or equivalent route-lock fields.',
    '- If the premise is "investigate X", include evidenceSlots and an investigationBudget so the scene must converge.',
    '',
    'Existing active quests:',
    JSON.stringify(existingQuests, null, 2),
    '',
    'Scene/context:',
    sceneContext || '(none)',
    '',
    'Seed text:',
    seedText || '(none)',
    '',
    'User rules:',
    userRules || '(none)',
    '',
    'Return JSON only with: questId, title, hookText, objective, successCriteria, evidenceSlots, openLeads, stakeholders, locations, difficultyHint, riskHint, rewardHints, failureImpact, expiry, investigationBudget.'
  ].join('\n');
}

export function buildQuestRelevancePrompt({ text = '', quests = [], sceneContext = '', userRules = '' } = {}) {
  return [
    'Decide which active open-ended RPG quests are affected by the new text.',
    '',
    'Return JSON only with: relevant, questIds, shouldCheckCompletion, shouldResolveInvestigation, reason, confidence.',
    'Only mark a quest relevant when the text plausibly changes evidence, progress, risk, status, reward, or consequence.',
    '',
    'Active quests:',
    JSON.stringify(quests, null, 2),
    '',
    'Scene/context:',
    sceneContext || '(none)',
    '',
    'New text:',
    text || '(none)',
    '',
    'User rules:',
    userRules || '(none)'
  ].join('\n');
}

export function buildInvestigationTickPrompt({ quest, sourceText = '', sceneContext = '', recentEvents = [], userRules = '' } = {}) {
  return [
    'Resolve exactly one investigation/progress tick for this quest.',
    '',
    'Hard convergence rules:',
    ...DEFAULT_ANTI_RAILROAD_RULES.map((rule) => `- ${rule}`),
    '- Output tickType as exactly one of: evidence, exclusion, risk, conclusion.',
    '- If the player investigates, do not merely add another place/door/object. The tick must fill evidence, exclude a possibility, add meaningful risk, or conclude.',
    '- If budgetRemaining is 0 or becomes 0, set mustConcludeNow=true and prefer conclusion/reportable/completed/failed over more expansion.',
    '- Success does not require following a route; judge whether the objective became reportable or satisfied.',
    '',
    'Quest:',
    JSON.stringify(quest, null, 2),
    '',
    'Recent quest events:',
    JSON.stringify(recentEvents, null, 2),
    '',
    'Scene/context:',
    sceneContext || '(none)',
    '',
    'New text:',
    sourceText || '(none)',
    '',
    'User rules:',
    userRules || '(none)',
    '',
    'Return JSON only with: tickType, summary, evidenceUpdates, pressureDelta, budgetSpent, mustConcludeNow, questStatus, linkedNpcIds, linkedFactionIds, metadata.'
  ].join('\n');
}

export function buildQuestCompletionPrompt({ quest, sourceText = '', sceneContext = '', recentEvents = [], userRules = '' } = {}) {
  return [
    'Judge whether this open-ended quest objective was achieved.',
    '',
    'Rules:',
    '- Judge outcome, not route compliance.',
    '- A clever, absurd, indirect, negotiated, violent, magical, or social solution can complete the quest if it satisfies the objective.',
    '- If enough evidence exists but the quest requires reporting back, use status=reportable.',
    '- If the objective is clearly achieved, use status=completed.',
    '- If the objective can no longer be achieved, use status=failed.',
    '',
    'Quest:',
    JSON.stringify(quest, null, 2),
    '',
    'Recent quest events:',
    JSON.stringify(recentEvents, null, 2),
    '',
    'Scene/context:',
    sceneContext || '(none)',
    '',
    'New text:',
    sourceText || '(none)',
    '',
    'User rules:',
    userRules || '(none)',
    '',
    'Return JSON only with: objectiveSatisfied, status, reason, satisfiedCriteria, evidenceUpdates, rewardEligible, confidence, metadata.'
  ].join('\n');
}

export function buildRewardPrompt({ quest, completion = {}, processSummary = '', userRules = '' } = {}) {
  return [
    'Plan a fair RPG quest reward.',
    '',
    'Consider difficulty, risk, process, collateral damage, patron resources, and whether the stated objective was cleanly achieved.',
    'Reward can be money, items, status, favors, information, map access, faction shifts, consequences, or comic fallout.',
    '',
    'Quest:',
    JSON.stringify(quest, null, 2),
    '',
    'Completion decision:',
    JSON.stringify(completion, null, 2),
    '',
    'Process summary:',
    processSummary || '(none)',
    '',
    'User rules:',
    userRules || '(none)',
    '',
    'Return JSON only with: rewardTier, rewards, withheldRewards, complications, rationale.'
  ].join('\n');
}

export function buildConsequencePrompt({ quest, failureOrExpiry = {}, userRules = '' } = {}) {
  return [
    'Plan quest consequences for failure, expiry, abandonment, or ignoring a rumor.',
    '',
    'Consequences should be proportional. Some small quests can simply fade out; major quests can trigger faction, NPC, map, or world-clock effects.',
    '',
    'Quest:',
    JSON.stringify(quest, null, 2),
    '',
    'Failure/expiry event:',
    JSON.stringify(failureOrExpiry, null, 2),
    '',
    'User rules:',
    userRules || '(none)',
    '',
    'Return JSON only with: consequenceTier, immediateEffects, delayedEffects, affectedNpcs, affectedFactions, affectedLocations, rationale.'
  ].join('\n');
}

function findExistingQuest(manager, collection, input = {}) {
  if (input.id) return manager.getRecord(collection, input.id, { missing: 'undefined' });
  if (input.questId) return manager.getRecord(collection, questRecordId(input.questId), { missing: 'undefined' });
  return undefined;
}

function applyQuestEventToRecord(quest, event, { now = () => new Date().toISOString(), autoReportable = true } = {}) {
  const timestamp = now();
  const next = {
    ...quest,
    evidenceSlots: normalizeEvidenceSlots(quest.evidenceSlots),
    knownFacts: normalizeStringArray(quest.knownFacts),
    suspectedFacts: normalizeStringArray(quest.suspectedFacts),
    questUpdatedAt: timestamp
  };
  for (const update of normalizeEvidenceUpdates(event.evidenceUpdates)) {
    applyEvidenceUpdate(next.evidenceSlots, update);
    if (update.value && ['filled', 'partial'].includes(update.status)) {
      next.knownFacts = appendUnique(next.knownFacts, String(update.value));
    }
    if (update.value && update.status === 'excluded') {
      next.suspectedFacts = appendUnique(next.suspectedFacts, `Excluded: ${update.value}`);
    }
  }
  if (event.summary && ['evidence', 'conclusion'].includes(event.tickType)) {
    next.knownFacts = appendUnique(next.knownFacts, event.summary);
  }
  if (event.summary && ['exclusion', 'risk'].includes(event.tickType)) {
    next.suspectedFacts = appendUnique(next.suspectedFacts, event.summary);
  }
  if (event.budgetSpent > 0) {
    next.budgetRemaining = Math.max(0, Number(next.budgetRemaining || 0) - Number(event.budgetSpent || 0));
  }
  if (event.pressureDelta) {
    next.resolutionPressure = advanceResolutionPressure(next.resolutionPressure, event.pressureDelta);
  }
  if (['exclusion', 'risk'].includes(event.tickType) && event.evidenceUpdates.length === 0) {
    next.deadEndCount = Number(next.deadEndCount || 0) + 1;
  }
  const requestedStatus = normalizeOptionalText(event.metadata?.questStatus);
  if (requestedStatus) next.status = normalizeQuestStatus(requestedStatus);
  return deriveQuestStatusAfterProgress(next, { autoReportable });
}

function applyEvidenceUpdate(slots, update) {
  const slotId = update.slotId || update.id;
  let slot = slots.find((candidate) => candidate.id === slotId);
  if (!slot) {
    slot = {
      id: slotId || slugId(update.description || update.value || 'evidence', 'evidence'),
      description: update.description || update.value || 'New evidence',
      required: false,
      status: 'empty',
      value: '',
      notes: []
    };
    slots.push(slot);
  }
  slot.status = update.status || slot.status;
  if (update.value !== undefined) slot.value = update.value;
  if (update.description) slot.description = update.description;
  if (update.note) slot.notes = appendUnique(normalizeStringArray(slot.notes), update.note);
  slot.updatedAt = new Date().toISOString();
}

function deriveQuestStatusAfterProgress(quest, { autoReportable = true } = {}) {
  if (!autoReportable || !ACTIVE_QUEST_STATUSES.has(quest.status)) return quest;
  const required = normalizeEvidenceSlots(quest.evidenceSlots).filter((slot) => slot.required);
  if (required.length > 0 && required.every((slot) => slot.status === 'filled')) {
    return {
      ...quest,
      status: quest.status === 'rumor' ? 'reportable' : quest.status === 'tracked' || quest.status === 'dormant' ? 'reportable' : quest.status
    };
  }
  if (Number(quest.budgetRemaining || 0) <= 0 && ['none', 'low'].includes(quest.resolutionPressure)) {
    return {
      ...quest,
      resolutionPressure: 'high'
    };
  }
  return quest;
}

function normalizeSuccessCriteria(value) {
  const items = normalizeArray(value);
  return items.map((item, index) => {
    if (typeof item === 'string') {
      return {
        id: `criterion_${index + 1}`,
        text: item,
        status: 'open'
      };
    }
    const object = normalizeObject(item);
    return {
      id: normalizeOptionalText(object.id || object.criterionId) || `criterion_${index + 1}`,
      text: normalizeOptionalText(object.text || object.description || object.value) || `Criterion ${index + 1}`,
      status: normalizeOptionalText(object.status) || 'open',
      metadata: normalizeObject(object.metadata)
    };
  });
}

function normalizeEvidenceSlots(value) {
  const items = normalizeArray(value);
  return items.map((item, index) => {
    if (typeof item === 'string') {
      return {
        id: slugId(item, `evidence_${index + 1}`),
        description: item,
        required: true,
        status: 'empty',
        value: '',
        notes: []
      };
    }
    const object = normalizeObject(item);
    const status = normalizeEvidenceStatus(object.status || (object.filled || object.value ? 'filled' : 'empty'));
    return {
      id: normalizeOptionalText(object.id || object.slotId || object.name) || `evidence_${index + 1}`,
      description: normalizeOptionalText(object.description || object.text || object.name) || `Evidence ${index + 1}`,
      required: Boolean(object.required ?? true),
      status,
      value: object.value ?? '',
      notes: normalizeStringArray(object.notes),
      metadata: normalizeObject(object.metadata)
    };
  });
}

function normalizeEvidenceUpdates(value) {
  return normalizeArray(value).map((item, index) => {
    if (typeof item === 'string') {
      return {
        slotId: `evidence_${index + 1}`,
        status: 'filled',
        value: item,
        description: '',
        note: ''
      };
    }
    const object = normalizeObject(item);
    return {
      slotId: normalizeOptionalText(object.slotId || object.id || object.evidenceId) || `evidence_${index + 1}`,
      status: normalizeEvidenceStatus(object.status || object.state || 'filled'),
      value: object.value ?? object.text ?? object.fact ?? '',
      description: normalizeOptionalText(object.description),
      note: normalizeOptionalText(object.note || object.reason)
    };
  });
}

function normalizeEvidenceStatus(value) {
  const normalized = String(value || 'empty').trim().toLowerCase();
  if (['empty', 'open', 'unknown'].includes(normalized)) return 'empty';
  if (['partial', 'partially_filled', 'partly'].includes(normalized)) return 'partial';
  if (['filled', 'complete', 'confirmed', 'done'].includes(normalized)) return 'filled';
  if (['excluded', 'false', 'rejected'].includes(normalized)) return 'excluded';
  throw validationError(`Unsupported evidence status: ${value}`);
}

function defaultQuestHook(input = {}) {
  const seed = normalizeOptionalText(input.seedText || input.text || input.content) || 'A local rumor needs attention.';
  return {
    title: input.title || seed.slice(0, 40),
    hookText: seed,
    objective: input.objective || 'Resolve the problem behind this rumor.',
    successCriteria: input.successCriteria || ['The underlying problem is solved or made safely reportable.'],
    evidenceSlots: input.evidenceSlots || [{ id: 'core_evidence', description: 'Core fact proving what is happening', required: true }],
    openLeads: input.openLeads || [],
    investigationBudget: input.investigationBudget || 3
  };
}

function defaultInvestigationTick(quest = {}) {
  return {
    tickType: Number(quest.budgetRemaining || 0) <= 1 ? 'conclusion' : 'risk',
    summary: Number(quest.budgetRemaining || 0) <= 1
      ? 'Investigation budget is exhausted; force a conclusion, reportable state, or failure.'
      : 'No LLM/tick was supplied; return an editable risk tick instead of inventing a new route.',
    budgetSpent: Number(quest.budgetRemaining || 0) <= 1 ? 0 : 1,
    mustConcludeNow: Number(quest.budgetRemaining || 0) <= 1,
    pressureDelta: 1
  };
}

function defaultCompletionDecision(quest = {}) {
  return {
    objectiveSatisfied: false,
    status: quest.status || 'tracked',
    reason: 'No completion decision supplied.',
    rewardEligible: false,
    confidence: 0.5
  };
}

function defaultRewardPlan(quest = {}) {
  return {
    rewardTier: quest.difficultyHint || 'minor',
    rewards: normalizeArray(quest.rewardHints),
    withheldRewards: [],
    complications: [],
    rationale: 'Template reward plan; use LLM or user-supplied plan for final rewards.'
  };
}

function defaultConsequencePlan(quest = {}) {
  return {
    consequenceTier: quest.riskHint || 'minor',
    immediateEffects: normalizeArray(quest.failureImpact?.immediateEffects),
    delayedEffects: normalizeArray(quest.failureImpact?.delayedEffects),
    affectedNpcs: [],
    affectedFactions: [],
    affectedLocations: normalizeStringArray(quest.locations),
    rationale: 'Template consequence plan; use LLM or user-supplied plan for final consequences.'
  };
}

function normalizeRewardPlan(input = {}, quest = {}) {
  return {
    questId: quest.questId,
    rewardTier: normalizeOptionalText(input.rewardTier || input.tier) || 'minor',
    rewards: normalizeArray(input.rewards),
    withheldRewards: normalizeArray(input.withheldRewards),
    complications: normalizeArray(input.complications),
    rationale: normalizeOptionalText(input.rationale || input.reason) || ''
  };
}

function normalizeConsequencePlan(input = {}, quest = {}) {
  return {
    questId: quest.questId,
    consequenceTier: normalizeOptionalText(input.consequenceTier || input.tier) || 'minor',
    immediateEffects: normalizeArray(input.immediateEffects),
    delayedEffects: normalizeArray(input.delayedEffects),
    affectedNpcs: normalizeStringArray(input.affectedNpcs || input.npcIds),
    affectedFactions: normalizeStringArray(input.affectedFactions || input.factionIds),
    affectedLocations: normalizeStringArray(input.affectedLocations || input.locations),
    rationale: normalizeOptionalText(input.rationale || input.reason) || ''
  };
}

function ruleBasedQuestRelevance(input = {}, quests = []) {
  const text = normalizeSearchText(input.text || input.sourceText || input.content || '');
  const questIds = [];
  for (const quest of quests) {
    const terms = [
      quest.questId,
      quest.title,
      quest.objective,
      ...normalizeStringArray(quest.openLeads),
      ...normalizeArray(quest.evidenceSlots).map((slot) => slot.description || slot.id)
    ].map(normalizeSearchText).filter((term) => term.length >= 2);
    const matched = terms.some((term) => text.includes(term) || term.includes(text) && text.length >= 2);
    if (matched) questIds.push(quest.questId);
  }
  return {
    relevant: questIds.length > 0,
    questIds,
    shouldCheckCompletion: questIds.length > 0,
    shouldResolveInvestigation: questIds.length > 0,
    reason: questIds.length ? 'Rule-based text overlap matched active quests.' : 'Rule-based check found no quest overlap.',
    confidence: questIds.length ? 0.55 : 0.9
  };
}

async function generateQuestJson({ chatProvider, prompt, system, temperature, maxTokens, missingMessage }) {
  if (!chatProvider || typeof chatProvider.generate !== 'function') {
    throw validationError(missingMessage);
  }
  const completion = await chatProvider.generate({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ],
    temperature: temperature ?? 0,
    maxTokens
  });
  return {
    content: completion.content,
    raw: completion.raw,
    json: parseJsonObject(completion.content)
  };
}

function parseJsonObject(text) {
  const source = String(text || '').trim();
  if (!source) throw validationError('LLM returned empty content');
  try {
    const parsed = parseFirstJsonObject(source);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw validationError('LLM JSON must be an object');
    return parsed;
  } catch (error) {
    throw error;
  }
}

function isQuestClockDue(clock = {}, input = {}) {
  if (clock.status !== 'active' && !(input.includePaused && clock.status === 'paused')) return false;
  const elapsed = input.elapsedSeconds ?? input.clock?.elapsedSeconds;
  const round = input.roundNumber ?? input.clock?.roundNumber ?? input.encounter?.roundNumber;
  if (clock.expiresAtElapsedSeconds !== undefined && clock.expiresAtElapsedSeconds !== null && clock.expiresAtElapsedSeconds !== '') {
    if (elapsed !== undefined && Number(elapsed) >= Number(clock.expiresAtElapsedSeconds)) return true;
  }
  if (clock.expiresAtRound !== undefined && clock.expiresAtRound !== null && clock.expiresAtRound !== '') {
    if (round !== undefined && Number(round) >= Number(clock.expiresAtRound)) return true;
  }
  if (clock.expiresAtSceneEnd && input.sceneEnded) return true;
  return false;
}

function compactClock(clock = {}) {
  return {
    questId: clock.questId,
    expiresAtElapsedSeconds: clock.expiresAtElapsedSeconds,
    expiresAtRound: clock.expiresAtRound,
    expiresAtSceneEnd: Boolean(clock.expiresAtSceneEnd),
    expireMode: clock.expireMode
  };
}

function exportRecordData(record) {
  return {
    id: record.id,
    ...record.data
  };
}

function normalizeImportRecords(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function defaultInvestigationBudget(input = {}) {
  const objective = normalizeOptionalText(input.objective || input.title || '');
  if (/调查|侦查|寻找|查明|investigat|search|find/i.test(objective)) return 3;
  return 2;
}

function normalizeQuestStatus(value, field = 'status') {
  const normalized = String(value || '').trim();
  if (!QUEST_STATUSES.has(normalized)) throw validationError(`${field} must be one of: ${[...QUEST_STATUSES].join(', ')}`);
  return normalized;
}

function normalizeResolutionPressure(value) {
  const normalized = String(value || 'none').trim();
  if (RESOLUTION_PRESSURE.includes(normalized)) return normalized;
  const lower = normalized.toLowerCase();
  if (lower === 'forcecheck' || lower === 'force_check') return 'forceCheck';
  throw validationError(`resolutionPressure must be one of: ${RESOLUTION_PRESSURE.join(', ')}`);
}

function advanceResolutionPressure(value, delta = 0) {
  const current = RESOLUTION_PRESSURE.indexOf(normalizeResolutionPressure(value || 'none'));
  const next = Math.max(0, Math.min(RESOLUTION_PRESSURE.length - 1, current + Number(delta || 0)));
  return RESOLUTION_PRESSURE[next];
}

function normalizeTickType(value) {
  const normalized = String(value || '').trim();
  if (!INVESTIGATION_TICK_TYPES.has(normalized)) {
    throw validationError(`tickType must be one of: ${[...INVESTIGATION_TICK_TYPES].join(', ')}`);
  }
  return normalized;
}

function normalizeOptionalTickType(value) {
  const normalized = normalizeOptionalText(value);
  return normalized ? normalizeTickType(normalized) : '';
}

function defaultTickSummary(tickType, sourceText) {
  const prefix = {
    evidence: 'Evidence discovered',
    exclusion: 'A possibility was excluded',
    risk: 'A meaningful risk emerged',
    conclusion: 'The investigation converged'
  }[tickType] || 'Quest tick';
  return sourceText ? `${prefix}: ${sourceText}` : prefix;
}

function assertNoForbiddenRouteFields(value) {
  const matches = findForbiddenRouteFields(value);
  if (matches.length > 0) {
    throw validationError(`Forbidden route fields in quest data: ${matches.join(', ')}. Use objective, successCriteria, evidenceSlots, and openLeads instead of fixed route chains.`);
  }
}

export function findForbiddenRouteFields(value, path = '$', matches = []) {
  if (!value || typeof value !== 'object') return matches;
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenRouteFields(item, `${path}[${index}]`, matches));
    return matches;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/[_\-\s]/g, '').toLowerCase();
    if (FORBIDDEN_ROUTE_FIELDS.has(normalized)) matches.push(`${path}.${key}`);
    findForbiddenRouteFields(child, `${path}.${key}`, matches);
  }
  return matches;
}

function questRecordId(questId) {
  return String(questId);
}

function questEventRecordId(questId, eventId) {
  return `${questId}:${eventId}`;
}

function questClockRecordId(questId) {
  return String(questId);
}

function slugId(value, fallback = 'id') {
  const source = String(value || '').trim().toLowerCase();
  const slug = source
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return slug || createId(fallback);
}

function appendUnique(items, value) {
  const normalized = normalizeStringArray(items);
  const text = normalizeOptionalText(value);
  if (!text || normalized.includes(text)) return normalized;
  return [...normalized, text];
}

function normalizeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value };
}

function normalizeArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeStringArray(value) {
  return normalizeArray(value)
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') return String(item.id || item.name || item.title || item.text || item.description || '').trim();
      return String(item ?? '').trim();
    })
    .filter(Boolean);
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

function normalizeSearchText(value) {
  return normalizeOptionalText(value).toLowerCase();
}

function normalizeInteger(value, field) {
  const number = Number(value ?? 0);
  if (!Number.isInteger(number)) throw validationError(`${field} must be an integer`);
  return number;
}

function normalizeNonNegativeInteger(value, field) {
  const number = normalizeInteger(value, field);
  if (number < 0) throw validationError(`${field} must be >= 0`);
  return number;
}

function normalizeNullableNonNegativeInteger(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  return normalizeNonNegativeInteger(value, field);
}

function normalizeBooleanInteger(value) {
  return value ? 1 : 0;
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'VALIDATION_ERROR';
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  error.code = 'NOT_FOUND';
  return error;
}
