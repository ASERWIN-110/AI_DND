// @ts-nocheck
import YAML from 'yaml';
import { documentToCollections, parseStructuredDocument } from '../data/structured-document-importer.js';
import { StructuredInterfaceTraceRecorder } from '../structured/structured-interface.js';
import { createId } from '../utils/id.js';
import { parseFirstJsonObject } from '../utils/json.js';

export const ENCOUNTER_RECORDS_COLLECTION = 'encounter_records';
export const ENCOUNTER_EVENTS_COLLECTION = 'encounter_events';

export const ENCOUNTER_RECORD_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id.' },
  { name: 'encounterId', type: 'text', description: 'Stable encounter id inside one chat.' },
  { name: 'title', type: 'text', description: 'Human-readable encounter title.' },
  { name: 'status', type: 'text', description: 'triggered, engaged, resolved, failed, escaped, or archived.' },
  { name: 'sceneId', type: 'text', description: 'Scene where this encounter happened.' },
  { name: 'encounterType', type: 'text', description: 'social, combat, discovery, reward, rumor, environment, wonder, or mixed.' },
  { name: 'luckTier', type: 'text', description: 'dire, poor, mixed, favorable, or exceptional.' },
  { name: 'luckScore', type: 'number', description: 'Optional normalized 0-100 luck score.' },
  { name: 'luckDetail', type: 'json', description: 'Original luck check, roll, margin, or trigger details.' },
  { name: 'sourceTriggerEventId', type: 'text', description: 'Optional trigger_events event id that caused this encounter.' },
  { name: 'entryText', type: 'text', description: 'Player-facing encounter arrival text. This is not a rumor.' },
  { name: 'immediateSituation', type: 'text', description: 'What is already happening right now.' },
  { name: 'objective', type: 'text', description: 'Outcome-focused resolution objective for convergence.' },
  { name: 'resolutionCriteria', type: 'json', description: 'One to three route-free criteria that can resolve the encounter.' },
  { name: 'stateFacts', type: 'json', description: 'Confirmed encounter facts.' },
  { name: 'openQuestions', type: 'json', description: 'Optional open questions that should converge quickly.' },
  { name: 'involvedNpcIds', type: 'json', description: 'NPC or actor ids involved.' },
  { name: 'involvedFactionIds', type: 'json', description: 'Faction ids involved.' },
  { name: 'locations', type: 'json', description: 'Related map or location ids/labels.' },
  { name: 'difficultyHint', type: 'text', description: 'Narrative difficulty label.' },
  { name: 'riskHint', type: 'text', description: 'Narrative risk label.' },
  { name: 'rewardHints', type: 'json', description: 'Possible rewards if the encounter is resolved well.' },
  { name: 'failureImpact', type: 'json', description: 'Consequences only allowed after failed event/combat/outcome, never on trigger alone.' },
  { name: 'noFreePunishmentRule', type: 'integer', description: 'Boolean 0/1: occurrence alone cannot inflict punishment.' },
  { name: 'resolutionPressure', type: 'text', description: 'none, low, medium, high, or forceCheck.' },
  { name: 'resolutionBudget', type: 'integer', description: 'Maximum meaningful progress ticks before convergence is forced.' },
  { name: 'budgetRemaining', type: 'integer', description: 'Remaining progress/convergence ticks.' },
  { name: 'metadata', type: 'json', description: 'Extra encounter metadata.' },
  { name: 'createdAtIso', type: 'text', description: 'Creation timestamp.' },
  { name: 'encounterUpdatedAt', type: 'text', description: 'Latest update timestamp.' }
];

export const ENCOUNTER_EVENT_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id.' },
  { name: 'eventId', type: 'text', description: 'Stable event id.' },
  { name: 'encounterId', type: 'text', description: 'Owning encounter id.' },
  { name: 'eventType', type: 'text', description: 'start, progress_tick, outcome_check, reward, consequence, status, note, etc.' },
  { name: 'sourceText', type: 'text', description: 'Raw player/GM/action text that caused this event.' },
  { name: 'summary', type: 'text', description: 'Short event summary.' },
  { name: 'sceneId', type: 'text', description: 'Optional scene id.' },
  { name: 'linkedActionId', type: 'text', description: 'Optional action resolver id.' },
  { name: 'linkedNpcIds', type: 'json', description: 'NPC or actor ids involved.' },
  { name: 'linkedFactionIds', type: 'json', description: 'Faction ids involved.' },
  { name: 'stateUpdates', type: 'json', description: 'Facts or criteria changes caused by this event.' },
  { name: 'pressureDelta', type: 'integer', description: 'Resolution pressure adjustment.' },
  { name: 'budgetSpent', type: 'integer', description: 'Meaningful progress budget spent by this event.' },
  { name: 'tickType', type: 'text', description: 'clue, state_change, choice, combat, reward, setback, or conclusion.' },
  { name: 'metadata', type: 'json', description: 'Extra event metadata.' },
  { name: 'createdAtIso', type: 'text', description: 'Event timestamp.' }
];

export const ENCOUNTER_STATUSES = new Set(['triggered', 'engaged', 'resolved', 'failed', 'escaped', 'archived']);
export const ACTIVE_ENCOUNTER_STATUSES = new Set(['triggered', 'engaged']);
export const ENCOUNTER_TYPES = new Set(['social', 'combat', 'discovery', 'reward', 'rumor', 'environment', 'wonder', 'mixed']);
export const ENCOUNTER_TICK_TYPES = new Set(['clue', 'state_change', 'choice', 'combat', 'reward', 'setback', 'conclusion']);
export const ENCOUNTER_PRESSURE = ['none', 'low', 'medium', 'high', 'forceCheck'];
export const LUCK_TIERS = ['dire', 'poor', 'mixed', 'favorable', 'exceptional'];

export const ENCOUNTER_RULES = [
  'The encounter has already happened; it is not a rumor that the player can accept or ignore.',
  'The encounter occurrence itself must not inflict damage, attribute loss, item loss, resource loss, or other punishment.',
  'Danger, combat, costs, and consequences are only applied after a failed action check, failed event objective, failed combat, or explicit player choice.',
  'Luck changes encounter quality: high luck can create rewards, allies, clues, shortcuts, or comedy; low luck can create danger, combat, pressure, or hard choices without free punishment.',
  'An encounter may reveal a rumor or quest hook, but the encounter record itself remains an already-present situation.',
  'Every meaningful tick must progress, change state, introduce a choice, resolve combat, grant a reward, create a consequence from failure, or conclude.',
  'Do not extend the encounter by endlessly adding rooms, clues, strangers, or complications without spending budget or converging.'
];

export const ENCOUNTER_PROMPT_TEMPLATES = {
  create: {
    id: 'luck_based_encounter_creation',
    description: 'Create an already-triggered encounter from luck, scene context, trigger result, and user reference templates.',
    outputShape: {
      encounterId: 'stable_id',
      title: 'short title',
      status: 'triggered',
      encounterType: 'social|combat|discovery|reward|rumor|environment|wonder|mixed',
      entryText: 'what the player immediately encounters',
      immediateSituation: 'what is happening now',
      objective: 'route-free resolution objective',
      resolutionCriteria: ['1-3 route-free criteria'],
      rewardHints: ['possible rewards if resolved well'],
      failureImpact: { note: 'only after failure' },
      resolutionBudget: 2
    }
  },
  progressTick: {
    id: 'encounter_progress_convergence_tick',
    description: 'Resolve one encounter tick without free punishment or endless expansion.',
    outputShape: {
      tickType: 'clue|state_change|choice|combat|reward|setback|conclusion',
      summary: 'what changed',
      stateUpdates: [{ criterionId: 'criterion_id', status: 'resolved|partial|failed', value: 'fact' }],
      budgetSpent: 1,
      mustConcludeNow: false,
      encounterStatus: 'engaged|resolved|failed|escaped'
    }
  },
  outcome: {
    id: 'encounter_outcome_check',
    description: 'Judge whether the encounter resolved, failed, escaped, or remains engaged.',
    outputShape: {
      resolved: true,
      failed: false,
      status: 'resolved|failed|escaped|engaged',
      reason: 'short reason',
      rewardEligible: true,
      consequenceEligible: false
    }
  }
};

export class EncounterManager {
  constructor({
    appDatabase,
    collections = {},
    trace,
    traceRecorder,
    chatProvider,
    toolManager,
    cwd = process.cwd(),
    now
  } = {}) {
    if (!appDatabase) throw validationError('EncounterManager requires appDatabase');
    this.appDatabase = appDatabase;
    this.collections = {
      records: collections.records || ENCOUNTER_RECORDS_COLLECTION,
      events: collections.events || ENCOUNTER_EVENTS_COLLECTION
    };
    this.chatProvider = chatProvider;
    this.toolManager = toolManager;
    this.now = now || (() => new Date().toISOString());
    this.traceRecorder = traceRecorder || new StructuredInterfaceTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      directory: trace?.directory || 'data/encounter-traces',
      cwd,
      now: this.now
    });
  }

  ensureCollections(chatSessionId) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const database = this.appDatabase.ensureChatDataDatabase(normalizedChatSessionId);
    const manager = this.appDatabase.openChatDataManagerByChatId(normalizedChatSessionId);
    const specs = [
      [this.collections.records, ENCOUNTER_RECORD_FIELDS, 'encounters:records'],
      [this.collections.events, ENCOUNTER_EVENT_FIELDS, 'encounters:events']
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
      statuses: [...ENCOUNTER_STATUSES],
      activeStatuses: [...ACTIVE_ENCOUNTER_STATUSES],
      encounterTypes: [...ENCOUNTER_TYPES],
      tickTypes: [...ENCOUNTER_TICK_TYPES],
      luckTiers: LUCK_TIERS,
      rules: ENCOUNTER_RULES,
      templates: ENCOUNTER_PROMPT_TEMPLATES
    };
  }

  assessLuck(input = {}) {
    return normalizeLuck(input.luck || input.luckCheck || input.diceResult || input.rollResult || input);
  }

  buildCreatePrompt(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    return buildEncounterCreatePrompt({
      triggerResult: input.triggerResult || input.trigger || {},
      luck: this.assessLuck(input),
      sceneContext: input.sceneContext || input.context || '',
      mapContext: input.mapContext || '',
      npcContext: input.npcContext || '',
      partyContext: input.partyContext || '',
      sourceText: input.sourceText || input.text || input.content || '',
      referenceTemplate: input.referenceTemplate || input.template || '',
      userRules: input.userRules || input.rules || '',
      activeEncounters: this.listEncounters({ chatSessionId, activeOnly: true, limit: 50 }).records.map((record) => record.data)
    });
  }

  async createEncounter(input = {}, { chatProvider = this.chatProvider } = {}) {
    return this.withTrace('encounter-create', input.chatSessionId, input, async () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const luck = this.assessLuck(input);
      const prompt = this.buildCreatePrompt(input);
      let rawEncounter = input.encounter || input.record || input.encounterRecord;
      let llm = { used: false, reason: rawEncounter ? 'encounter_supplied' : 'template' };
      if (!rawEncounter && input.useLlm) {
        const completion = await generateEncounterJson({
          chatProvider,
          prompt,
          system: 'You create already-triggered tabletop RPG encounters from luck and scene context. Return JSON only.',
          temperature: input.temperature,
          maxTokens: input.maxTokens || 1400,
          missingMessage: 'Encounter creation requested LLM, but no chatProvider is available'
        });
        rawEncounter = completion.json;
        llm = { used: true, content: completion.content, raw: completion.raw };
      }
      if (!rawEncounter) rawEncounter = defaultEncounter(input, luck);
      const encounter = normalizeEncounterRecord({
        ...rawEncounter,
        chatSessionId,
        sceneId: rawEncounter.sceneId || input.sceneId,
        status: rawEncounter.status || 'triggered',
        luckTier: rawEncounter.luckTier || luck.tier,
        luckScore: rawEncounter.luckScore ?? luck.score,
        luckDetail: rawEncounter.luckDetail || luck,
        sourceTriggerEventId: rawEncounter.sourceTriggerEventId || input.sourceTriggerEventId || input.triggerEventId
      }, {
        chatSessionId,
        now: this.now
      });
      if (input.dryRun === true) {
        return {
          prompt,
          luck,
          encounter,
          llm,
          dryRun: true
        };
      }
      const { manager } = this.openManager(chatSessionId);
      const record = manager.upsertRecord(this.collections.records, encounter, { id: encounterRecordId(encounter.encounterId) });
      const event = manager.upsertRecord(this.collections.events, normalizeEncounterEvent({
        chatSessionId,
        encounterId: encounter.encounterId,
        eventType: 'start',
        sourceText: input.sourceText || input.text || input.content,
        summary: encounter.entryText || encounter.title,
        sceneId: encounter.sceneId,
        linkedNpcIds: encounter.involvedNpcIds,
        linkedFactionIds: encounter.involvedFactionIds,
        metadata: {
          llm,
          luck,
          triggerResult: input.triggerResult || input.trigger,
          sourceTriggerEventId: encounter.sourceTriggerEventId
        }
      }, { chatSessionId, now: this.now }), {
        id: encounterEventRecordId(encounter.encounterId, createId('encounterevent'))
      });
      return {
        prompt,
        luck,
        encounter: record,
        event,
        llm,
        dryRun: false
      };
    });
  }

  upsertEncounter(input = {}) {
    return this.withTrace('encounter-upsert', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const { manager } = this.openManager(chatSessionId);
      const existing = findExistingEncounter(manager, this.collections.records, input);
      const encounter = normalizeEncounterRecord(input, {
        chatSessionId,
        existing: existing?.data,
        now: this.now
      });
      return {
        encounter: manager.upsertRecord(this.collections.records, encounter, { id: encounterRecordId(encounter.encounterId) })
      };
    });
  }

  patchEncounter(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const current = this.getEncounter({ chatSessionId, encounterId: input.encounterId, id: input.id });
    return this.upsertEncounter({
      ...current.data,
      ...normalizeObject(input.patch || input.update || {}),
      id: current.id,
      chatSessionId,
      encounterId: current.data.encounterId
    });
  }

  getEncounter({ chatSessionId, encounterId, id, missing = 'throw' } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    if (id) return manager.getRecord(this.collections.records, id, { missing });
    const normalizedEncounterId = normalizeRequiredText(encounterId, 'encounterId');
    const record = manager.getRecord(this.collections.records, encounterRecordId(normalizedEncounterId), { missing: 'undefined' });
    if (record) return record;
    const matches = manager.queryRecords(this.collections.records, {
      filter: { encounterId: normalizedEncounterId },
      limit: 2
    }).records;
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw validationError(`Multiple encounters matched encounterId: ${normalizedEncounterId}; use id`);
    if (missing === 'undefined') return undefined;
    throw notFound(`Encounter not found: ${normalizedEncounterId}`);
  }

  listEncounters({
    chatSessionId,
    status,
    activeOnly = false,
    sceneId,
    query = '',
    filter = {},
    sort = [{ field: 'encounterUpdatedAt', direction: 'desc' }],
    limit = 100,
    offset = 0
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    const mergedFilter = { ...filter };
    if (typeof status === 'string' && status) mergedFilter.status = normalizeEncounterStatus(status);
    if (sceneId) mergedFilter.sceneId = String(sceneId);
    const result = manager.queryRecords(this.collections.records, {
      filter: mergedFilter,
      sort,
      limit,
      offset
    });
    const statuses = Array.isArray(status) ? new Set(status.map(normalizeEncounterStatus)) : undefined;
    const normalizedQuery = normalizeSearchText(query);
    const records = result.records.filter((record) => {
      const data = record.data || {};
      if (statuses && !statuses.has(data.status)) return false;
      if (activeOnly && !ACTIVE_ENCOUNTER_STATUSES.has(data.status)) return false;
      if (!normalizedQuery) return true;
      return normalizeSearchText([
        record.id,
        data.encounterId,
        data.title,
        data.status,
        data.encounterType,
        data.entryText,
        data.immediateSituation,
        data.objective,
        JSON.stringify(data.resolutionCriteria || []),
        JSON.stringify(data.stateFacts || [])
      ].filter(Boolean).join(' ')).includes(normalizedQuery);
    });
    return {
      ...result,
      chatSessionId: normalizedChatSessionId,
      records
    };
  }

  setEncounterStatus(input = {}) {
    return this.withTrace('encounter-set-status', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const status = normalizeEncounterStatus(input.status, 'status');
      const encounter = this.getEncounter({ chatSessionId, encounterId: input.encounterId, id: input.id });
      const updated = this.upsertEncounter({
        ...encounter.data,
        chatSessionId,
        status,
        encounterUpdatedAt: this.now()
      }).encounter;
      const event = this.addEncounterEvent({
        chatSessionId,
        encounterId: updated.data.encounterId,
        eventType: input.eventType || 'status',
        summary: input.summary || `Encounter status set to ${status}`,
        sourceText: input.sourceText,
        metadata: input.metadata,
        applyToEncounter: false
      }).event;
      return { encounter: updated, event };
    });
  }

  archiveEncounter(input = {}) {
    return this.setEncounterStatus({
      ...input,
      status: 'archived',
      eventType: 'archive',
      summary: input.summary || 'Encounter archived'
    });
  }

  addEncounterEvent(input = {}) {
    return this.withTrace('encounter-add-event', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const encounter = this.getEncounter({ chatSessionId, encounterId: input.encounterId, id: input.encounterRecordId });
      const event = normalizeEncounterEvent({
        ...input,
        encounterId: encounter.data.encounterId
      }, {
        chatSessionId,
        now: this.now
      });
      const { manager } = this.openManager(chatSessionId);
      const eventRecord = manager.upsertRecord(this.collections.events, event, {
        id: encounterEventRecordId(event.encounterId, event.eventId)
      });
      let updatedEncounter = encounter;
      if (input.applyToEncounter !== false) {
        const nextEncounter = applyEncounterEventToRecord(encounter.data, event, {
          now: this.now,
          autoResolve: input.autoResolve !== false
        });
        updatedEncounter = manager.upsertRecord(this.collections.records, nextEncounter, {
          id: encounterRecordId(nextEncounter.encounterId)
        });
      }
      return {
        event: eventRecord,
        encounter: updatedEncounter
      };
    });
  }

  listEvents({
    chatSessionId,
    encounterId,
    eventType,
    filter = {},
    sort = [{ field: 'createdAtIso', direction: 'asc' }],
    limit = 200,
    offset = 0
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    const mergedFilter = { ...filter };
    if (encounterId) mergedFilter.encounterId = normalizeRequiredText(encounterId, 'encounterId');
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

  buildTickPrompt(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const encounter = this.getEncounter({ chatSessionId, encounterId: input.encounterId, id: input.id }).data;
    return buildEncounterTickPrompt({
      encounter,
      sourceText: input.sourceText || input.text || input.content || '',
      sceneContext: input.sceneContext || input.context || '',
      recentEvents: this.listEvents({ chatSessionId, encounterId: encounter.encounterId, limit: input.eventLimit || 20 }).records.map((record) => record.data),
      userRules: input.userRules || input.rules || ''
    });
  }

  async resolveTick(input = {}, { chatProvider = this.chatProvider } = {}) {
    return this.withTrace('encounter-progress-tick', input.chatSessionId, input, async () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const encounterRecord = this.getEncounter({ chatSessionId, encounterId: input.encounterId, id: input.id });
      const encounter = encounterRecord.data;
      const prompt = buildEncounterTickPrompt({
        encounter,
        sourceText: input.sourceText || input.text || input.content || '',
        sceneContext: input.sceneContext || input.context || '',
        recentEvents: this.listEvents({ chatSessionId, encounterId: encounter.encounterId, limit: input.eventLimit || 20 }).records.map((record) => record.data),
        userRules: input.userRules || input.rules || ''
      });
      let rawTick = input.tick || input.decision;
      let llm = { used: false, reason: rawTick ? 'tick_supplied' : 'template' };
      if (!rawTick && input.useLlm) {
        const completion = await generateEncounterJson({
          chatProvider,
          prompt,
          system: 'You resolve one already-triggered RPG encounter tick. Return JSON only.',
          temperature: input.temperature,
          maxTokens: input.maxTokens || 1200,
          missingMessage: 'Encounter progress tick requested LLM, but no chatProvider is available'
        });
        rawTick = completion.json;
        llm = { used: true, content: completion.content, raw: completion.raw };
      }
      const tick = normalizeEncounterTick(rawTick || defaultEncounterTick(encounter), {
        encounter,
        sourceText: input.sourceText || input.text || input.content || ''
      });
      if (input.dryRun !== false) {
        return {
          prompt,
          encounter: encounterRecord,
          tick,
          llm,
          dryRun: true
        };
      }
      const eventResult = this.addEncounterEvent({
        chatSessionId,
        encounterId: encounter.encounterId,
        eventType: 'progress_tick',
        sourceText: input.sourceText || input.text || input.content,
        summary: tick.summary,
        sceneId: input.sceneId || encounter.sceneId,
        linkedActionId: input.linkedActionId,
        linkedNpcIds: tick.linkedNpcIds || input.linkedNpcIds,
        linkedFactionIds: tick.linkedFactionIds || input.linkedFactionIds,
        stateUpdates: tick.stateUpdates,
        pressureDelta: tick.pressureDelta,
        budgetSpent: tick.budgetSpent,
        tickType: tick.tickType,
        metadata: {
          ...tick.metadata,
          encounterStatus: tick.encounterStatus,
          mustConcludeNow: tick.mustConcludeNow,
          noFreePunishmentRule: true,
          llm
        }
      });
      let encounterAfter = eventResult.encounter;
      if (tick.encounterStatus && tick.encounterStatus !== encounterAfter.data.status) {
        encounterAfter = this.setEncounterStatus({
          chatSessionId,
          encounterId: encounter.encounterId,
          status: tick.encounterStatus,
          eventType: 'progress_status',
          summary: `Progress tick set encounter ${tick.encounterStatus}`,
          metadata: { tickType: tick.tickType }
        }).encounter;
      }
      return {
        prompt,
        encounterBefore: encounterRecord,
        tick,
        event: eventResult.event,
        encounter: encounterAfter,
        llm,
        dryRun: false
      };
    });
  }

  buildOutcomePrompt(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const encounter = this.getEncounter({ chatSessionId, encounterId: input.encounterId, id: input.id }).data;
    return buildEncounterOutcomePrompt({
      encounter,
      sourceText: input.sourceText || input.text || input.content || '',
      sceneContext: input.sceneContext || input.context || '',
      recentEvents: this.listEvents({ chatSessionId, encounterId: encounter.encounterId, limit: input.eventLimit || 20 }).records.map((record) => record.data),
      userRules: input.userRules || input.rules || ''
    });
  }

  async checkOutcome(input = {}, { chatProvider = this.chatProvider } = {}) {
    return this.withTrace('encounter-outcome-check', input.chatSessionId, input, async () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const encounterRecord = this.getEncounter({ chatSessionId, encounterId: input.encounterId, id: input.id });
      const encounter = encounterRecord.data;
      const prompt = buildEncounterOutcomePrompt({
        encounter,
        sourceText: input.sourceText || input.text || input.content || '',
        sceneContext: input.sceneContext || input.context || '',
        recentEvents: this.listEvents({ chatSessionId, encounterId: encounter.encounterId, limit: input.eventLimit || 20 }).records.map((record) => record.data),
        userRules: input.userRules || input.rules || ''
      });
      let rawDecision = input.decision || input.outcome;
      let llm = { used: false, reason: rawDecision ? 'decision_supplied' : 'template' };
      if (!rawDecision && input.useLlm) {
        const completion = await generateEncounterJson({
          chatProvider,
          prompt,
          system: 'You judge whether an already-triggered RPG encounter resolved, failed, escaped, or remains engaged. Return JSON only.',
          temperature: input.temperature,
          maxTokens: input.maxTokens || 1200,
          missingMessage: 'Encounter outcome check requested LLM, but no chatProvider is available'
        });
        rawDecision = completion.json;
        llm = { used: true, content: completion.content, raw: completion.raw };
      }
      const decision = normalizeEncounterOutcome(rawDecision || defaultEncounterOutcome(encounter), encounter);
      if (input.dryRun !== false) {
        return {
          prompt,
          encounter: encounterRecord,
          decision,
          llm,
          dryRun: true
        };
      }
      const eventResult = this.addEncounterEvent({
        chatSessionId,
        encounterId: encounter.encounterId,
        eventType: 'outcome_check',
        sourceText: input.sourceText || input.text || input.content,
        summary: decision.reason,
        stateUpdates: decision.stateUpdates,
        metadata: {
          resolved: decision.resolved,
          failed: decision.failed,
          escaped: decision.escaped,
          rewardEligible: decision.rewardEligible,
          consequenceEligible: decision.consequenceEligible,
          llm
        }
      });
      let encounterAfter = eventResult.encounter;
      if (decision.status && decision.status !== encounterAfter.data.status) {
        encounterAfter = this.setEncounterStatus({
          chatSessionId,
          encounterId: encounter.encounterId,
          status: decision.status,
          eventType: 'outcome_status',
          summary: `Outcome check set encounter ${decision.status}`,
          metadata: {
            rewardEligible: decision.rewardEligible,
            consequenceEligible: decision.consequenceEligible
          }
        }).encounter;
      }
      return {
        prompt,
        encounterBefore: encounterRecord,
        decision,
        event: eventResult.event,
        encounter: encounterAfter,
        llm,
        dryRun: false
      };
    });
  }

  async planReward(input = {}, { chatProvider = this.chatProvider } = {}) {
    return this.withTrace('encounter-plan-reward', input.chatSessionId, input, async () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const encounter = this.getEncounter({ chatSessionId, encounterId: input.encounterId, id: input.id }).data;
      const prompt = buildEncounterRewardPrompt({
        encounter,
        outcome: input.outcome || input.decision || {},
        processSummary: input.processSummary || input.sourceText || '',
        userRules: input.userRules || input.rules || ''
      });
      let rawPlan = input.rewardPlan || input.plan;
      let llm = { used: false, reason: rawPlan ? 'plan_supplied' : 'template' };
      if (!rawPlan && input.useLlm) {
        const completion = await generateEncounterJson({
          chatProvider,
          prompt,
          system: 'You plan fair rewards for a resolved RPG encounter. Return JSON only.',
          temperature: input.temperature,
          maxTokens: input.maxTokens || 1000,
          missingMessage: 'Encounter reward planning requested LLM, but no chatProvider is available'
        });
        rawPlan = completion.json;
        llm = { used: true, content: completion.content, raw: completion.raw };
      }
      return {
        prompt,
        encounter,
        rewardPlan: normalizeEncounterRewardPlan(rawPlan || defaultEncounterRewardPlan(encounter), encounter),
        llm
      };
    });
  }

  async planConsequence(input = {}, { chatProvider = this.chatProvider } = {}) {
    return this.withTrace('encounter-plan-consequence', input.chatSessionId, input, async () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const encounter = this.getEncounter({ chatSessionId, encounterId: input.encounterId, id: input.id }).data;
      const prompt = buildEncounterConsequencePrompt({
        encounter,
        failure: input.failure || input.failureOrOutcome || input.event || {},
        userRules: input.userRules || input.rules || ''
      });
      let rawPlan = input.consequencePlan || input.plan;
      let llm = { used: false, reason: rawPlan ? 'plan_supplied' : 'template' };
      if (!rawPlan && input.useLlm) {
        const completion = await generateEncounterJson({
          chatProvider,
          prompt,
          system: 'You plan proportional consequences for a failed RPG encounter. Return JSON only.',
          temperature: input.temperature,
          maxTokens: input.maxTokens || 1000,
          missingMessage: 'Encounter consequence planning requested LLM, but no chatProvider is available'
        });
        rawPlan = completion.json;
        llm = { used: true, content: completion.content, raw: completion.raw };
      }
      return {
        prompt,
        encounter,
        consequencePlan: normalizeEncounterConsequencePlan(rawPlan || defaultEncounterConsequencePlan(encounter), encounter),
        llm
      };
    });
  }

  async applyReward(input = {}) {
    return this.withTrace('encounter-apply-reward', input.chatSessionId, input, async () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const encounter = this.getEncounter({ chatSessionId, encounterId: input.encounterId, id: input.id }).data;
      const rewardPlan = normalizeEncounterRewardPlan(input.rewardPlan || input.plan || defaultEncounterRewardPlan(encounter), encounter);
      const rewardApplication = await this.applyEncounterRewards({
        chatSessionId,
        sceneId: input.sceneId || encounter.sceneId,
        encounter,
        rewardPlan,
        input
      });
      const impactApplication = await this.applyExplicitEncounterToolCalls({
        chatSessionId,
        sceneId: input.sceneId || encounter.sceneId,
        encounter,
        phase: 'reward',
        plan: rewardPlan,
        input,
        rewardApplication
      });
      const eventResult = input.recordEvent === false || input.dryRun ? undefined : this.addEncounterEvent({
        chatSessionId,
        encounterId: encounter.encounterId,
        eventType: 'reward',
        tickType: 'reward',
        sceneId: input.sceneId || encounter.sceneId,
        sourceText: input.sourceText || input.text || input.content || rewardPlan.rationale,
        summary: input.summary || rewardPlan.rationale || `Applied encounter reward: ${encounter.title || encounter.encounterId}`,
        metadata: {
          rewardPlan,
          rewardApplication,
          impactApplication,
          source: 'encounter-apply-reward'
        },
        applyToEncounter: input.applyEventToEncounter !== false
      });
      return {
        encounter,
        rewardPlan,
        rewardApplication,
        impactApplication,
        event: eventResult?.event,
        eventResult,
        dryRun: Boolean(input.dryRun)
      };
    });
  }

  async applyConsequence(input = {}) {
    return this.withTrace('encounter-apply-consequence', input.chatSessionId, input, async () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const encounter = this.getEncounter({ chatSessionId, encounterId: input.encounterId, id: input.id }).data;
      const consequencePlan = normalizeEncounterConsequencePlan(input.consequencePlan || input.plan || defaultEncounterConsequencePlan(encounter), encounter);
      const impactApplication = await this.applyExplicitEncounterToolCalls({
        chatSessionId,
        sceneId: input.sceneId || encounter.sceneId,
        encounter,
        phase: 'consequence',
        plan: consequencePlan,
        input
      });
      const eventResult = input.recordEvent === false || input.dryRun ? undefined : this.addEncounterEvent({
        chatSessionId,
        encounterId: encounter.encounterId,
        eventType: 'consequence',
        tickType: 'setback',
        sceneId: input.sceneId || encounter.sceneId,
        sourceText: input.sourceText || input.text || input.content || consequencePlan.rationale,
        summary: input.summary || consequencePlan.rationale || `Applied encounter consequence: ${encounter.title || encounter.encounterId}`,
        linkedNpcIds: consequencePlan.affectedNpcs,
        linkedFactionIds: consequencePlan.affectedFactions,
        metadata: {
          consequencePlan,
          impactApplication,
          source: 'encounter-apply-consequence'
        },
        applyToEncounter: input.applyEventToEncounter !== false
      });
      return {
        encounter,
        consequencePlan,
        impactApplication,
        event: eventResult?.event,
        eventResult,
        dryRun: Boolean(input.dryRun)
      };
    });
  }

  async applyEncounterRewards({ chatSessionId, sceneId, encounter = {}, rewardPlan = {}, input = {} } = {}) {
    if (input.applyRewards === false) {
      return { status: 'skipped', reason: 'disabled' };
    }
    const rewards = normalizeEncounterRewardItems([
      ...normalizeArray(input.rewards),
      ...normalizeArray(input.loot),
      ...normalizeArray(rewardPlan.rewards),
      ...normalizeArray(rewardPlan.loot)
    ]);
    const currency = normalizeEncounterRewardCurrency([
      input.currency,
      rewardPlan.currency
    ]);
    if (!rewards.length && !Object.keys(currency).length) {
      return { status: 'skipped', reason: 'no_numeric_rewards' };
    }
    const recipientActorId = normalizeOptionalText(
      input.rewardActorId
      || input.recipientActorId
      || input.actorId
      || input.playerId
      || normalizeStringArray(input.recipientActorIds)[0]
    );
    if (!recipientActorId) {
      return { status: 'skipped', reason: 'missing_reward_recipient', rewards, currency };
    }
    const actorStateResult = await safeExecuteTool(this.toolManager, 'system.npc_state.get_state', {
      chatSessionId,
      sceneId,
      npcId: recipientActorId
    });
    const inventory = mergeEncounterRewardInventory(actorStateResult.output?.data?.inventory, {
      currency,
      items: rewards
    });
    const toolInput = removeUndefined({
      chatSessionId,
      sceneId,
      npcId: recipientActorId,
      inventory,
      source: 'encounter-apply-reward'
    });
    if (input.dryRun) {
      return {
        status: 'dry_run',
        tool: 'system.npc_state.patch_state',
        input: toolInput,
        rewards,
        currency,
        previousState: actorStateResult.ok ? actorStateResult.output : undefined
      };
    }
    if (!this.toolManager) {
      return { status: 'failure', reason: 'missing_tool_manager', tool: 'system.npc_state.patch_state', input: toolInput, rewards, currency };
    }
    const result = await this.toolManager.executeTool('system.npc_state.patch_state', toolInput, undefined, {
      actor: input.authorizationActor || input.actor || 'encounter-manager',
      reason: 'encounter-reward-inventory-update',
      audit: { skipAudit: true }
    });
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

  async applyExplicitEncounterToolCalls({ chatSessionId, sceneId, encounter = {}, phase = 'impact', plan = {}, input = {}, rewardApplication } = {}) {
    const calls = normalizeEncounterToolCalls(plan, {
      chatSessionId,
      sceneId,
      encounter,
      phase,
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
    if (!this.toolManager) {
      return { status: 'failure', reason: 'missing_tool_manager', plannedToolCalls: calls, failedToolCalls: calls.map((call) => ({ ...call, error: { name: 'MissingToolManager', message: 'EncounterManager requires toolManager to apply explicit encounter effects' } })) };
    }
    const appliedToolCalls = [];
    const failedToolCalls = [];
    for (const call of calls) {
      try {
        const result = await this.toolManager.executeTool(call.tool, removeUndefined(call.input), undefined, {
          authorization: input.authorization || input.userAuthorization || input.approval,
          actor: input.authorizationActor || input.actor || 'encounter-manager',
          reason: `encounter-${phase}-explicit-tool-call`,
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

  importEncounters(input = {}) {
    return this.withTrace('encounter-import', input.chatSessionId, input, () => {
      const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
      const { manager } = this.openManager(chatSessionId);
      const parsed = parseStructuredDocument(input);
      const data = parsed.data?.encounterSystem || parsed.data?.encounters || parsed.data || {};
      const directGroups = [
        { collection: this.collections.records, records: normalizeImportRecords(data.records || data.encounterRecords || data.encounters) },
        { collection: this.collections.events, records: normalizeImportRecords(data.events || data.encounterEvents) }
      ];
      const hasEncounterShape = directGroups.some((group) => group.records.length);
      const groups = hasEncounterShape
        ? directGroups
        : documentToCollections({
          data,
          collection: input.collection,
          collectionMap: {
            records: this.collections.records,
            encounters: this.collections.records,
            encounterRecords: this.collections.records,
            events: this.collections.events,
            encounterEvents: this.collections.events,
            ...(input.collectionMap || {})
          },
          idField: input.idField || 'id'
        });
      const imported = [];
      for (const group of groups.filter((candidate) => candidate.records?.length)) {
        for (const rawRecord of group.records) {
          if (group.collection === this.collections.records) {
            const { id, ...record } = rawRecord;
            const encounter = normalizeEncounterRecord({ ...record, chatSessionId }, { chatSessionId, now: this.now });
            imported.push(manager.upsertRecord(this.collections.records, encounter, { id: id || encounterRecordId(encounter.encounterId) }));
          } else if (group.collection === this.collections.events) {
            const { id, ...record } = rawRecord;
            const event = normalizeEncounterEvent({ ...record, chatSessionId }, { chatSessionId, now: this.now });
            imported.push(manager.upsertRecord(this.collections.events, event, { id: id || encounterEventRecordId(event.encounterId, event.eventId) }));
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

  exportEncounters({
    chatSessionId,
    format = 'json',
    includeEvents = true,
    status,
    activeOnly = false
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const encounters = this.listEncounters({
      chatSessionId: normalizedChatSessionId,
      status,
      activeOnly,
      limit: 500
    }).records;
    const encounterIds = new Set(encounters.map((record) => record.data.encounterId));
    const { manager } = this.openManager(normalizedChatSessionId);
    const payload = {
      encounterSystem: {
        records: encounters.map(exportRecordData)
      }
    };
    if (includeEvents) {
      payload.encounterSystem.events = manager.queryRecords(this.collections.events, {
        limit: 500,
        sort: [{ field: 'createdAtIso', direction: 'asc' }]
      }).records.filter((record) => encounterIds.has(record.data.encounterId)).map(exportRecordData);
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

  encounterSnapshot({ chatSessionId } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    return {
      chatSessionId: normalizedChatSessionId,
      encounters: manager.queryRecords(this.collections.records, { limit: 500 }).records.map((record) => ({ id: record.id, ...record.data })),
      events: manager.queryRecords(this.collections.events, { limit: 500 }).records.map((record) => ({ id: record.id, ...record.data }))
    };
  }

  withTrace(operation, chatSessionId, input, fn) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const before = this.encounterSnapshot({ chatSessionId: normalizedChatSessionId });
    const trace = this.traceRecorder.start(operation, {
      sessionId: normalizedChatSessionId,
      input,
      stateBefore: before
    });
    const finish = (output) => {
      const after = this.encounterSnapshot({ chatSessionId: normalizedChatSessionId });
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

export function normalizeEncounterRecord(input = {}, { chatSessionId, existing = {}, now = () => new Date().toISOString() } = {}) {
  assertNoForbiddenRouteFields(input);
  const timestamp = now();
  const title = normalizeOptionalText(input.title || existing.title) || 'Untitled Encounter';
  const encounterId = normalizeOptionalText(input.encounterId || input.id || existing.encounterId) || slugId(title, 'encounter');
  const resolutionBudget = normalizeNonNegativeInteger(
    input.resolutionBudget ?? existing.resolutionBudget ?? defaultResolutionBudget(input),
    'resolutionBudget'
  );
  const budgetRemaining = normalizeNonNegativeInteger(
    input.budgetRemaining ?? existing.budgetRemaining ?? resolutionBudget,
    'budgetRemaining'
  );
  const resolutionCriteria = normalizeResolutionCriteria(input.resolutionCriteria ?? input.successCriteria ?? existing.resolutionCriteria);
  const luck = normalizeLuck(input.luckDetail || {
    tier: input.luckTier ?? existing.luckTier,
    score: input.luckScore ?? existing.luckScore
  });
  const encounter = {
    chatSessionId: normalizeRequiredText(input.chatSessionId || chatSessionId || existing.chatSessionId, 'chatSessionId'),
    encounterId,
    title,
    status: normalizeEncounterStatus(input.status || existing.status || 'triggered'),
    sceneId: normalizeOptionalText(input.sceneId || existing.sceneId),
    encounterType: normalizeEncounterType(input.encounterType || input.type || existing.encounterType || defaultEncounterType(luck.tier)),
    luckTier: normalizeLuckTier(input.luckTier || existing.luckTier || luck.tier),
    luckScore: normalizeNullableNumber(input.luckScore ?? existing.luckScore ?? luck.score, 'luckScore'),
    luckDetail: normalizeObject(input.luckDetail ?? existing.luckDetail ?? luck),
    sourceTriggerEventId: normalizeOptionalText(input.sourceTriggerEventId || input.triggerEventId || existing.sourceTriggerEventId),
    entryText: normalizeOptionalText(input.entryText || input.hookText || input.arrivalText || existing.entryText) || title,
    immediateSituation: normalizeOptionalText(input.immediateSituation || input.situation || existing.immediateSituation) || title,
    objective: normalizeOptionalText(input.objective || existing.objective) || `Resolve: ${title}`,
    resolutionCriteria,
    stateFacts: normalizeStringArray(input.stateFacts ?? input.knownFacts ?? existing.stateFacts),
    openQuestions: normalizeStringArray(input.openQuestions ?? existing.openQuestions),
    involvedNpcIds: normalizeStringArray(input.involvedNpcIds || input.npcIds || existing.involvedNpcIds),
    involvedFactionIds: normalizeStringArray(input.involvedFactionIds || input.factionIds || existing.involvedFactionIds),
    locations: normalizeArray(input.locations ?? existing.locations),
    difficultyHint: normalizeOptionalText(input.difficultyHint ?? existing.difficultyHint),
    riskHint: normalizeOptionalText(input.riskHint ?? existing.riskHint),
    rewardHints: normalizeArray(input.rewardHints ?? input.rewards ?? existing.rewardHints),
    failureImpact: normalizeObject(input.failureImpact ?? existing.failureImpact),
    noFreePunishmentRule: normalizeBooleanInteger(input.noFreePunishmentRule ?? existing.noFreePunishmentRule ?? true),
    resolutionPressure: normalizePressure(input.resolutionPressure ?? existing.resolutionPressure ?? 'none'),
    resolutionBudget,
    budgetRemaining,
    metadata: normalizeObject(input.metadata ?? existing.metadata),
    createdAtIso: normalizeOptionalText(input.createdAtIso || existing.createdAtIso) || timestamp,
    encounterUpdatedAt: normalizeOptionalText(input.encounterUpdatedAt) || timestamp
  };
  if (encounter.resolutionCriteria.length > 3) encounter.resolutionCriteria = encounter.resolutionCriteria.slice(0, 3);
  if (encounter.resolutionCriteria.length === 0) {
    encounter.resolutionCriteria = [{
      id: 'core_resolution',
      text: `The encounter is safely resolved or clearly failed: ${encounter.objective}`,
      required: true,
      status: 'open',
      value: '',
      notes: []
    }];
  }
  return deriveEncounterStatusAfterProgress(encounter);
}

export function normalizeEncounterEvent(input = {}, { chatSessionId, now = () => new Date().toISOString() } = {}) {
  assertNoForbiddenRouteFields(input);
  const timestamp = now();
  const encounterId = normalizeRequiredText(input.encounterId, 'encounterId');
  return {
    chatSessionId: normalizeRequiredText(input.chatSessionId || chatSessionId, 'chatSessionId'),
    eventId: normalizeOptionalText(input.eventId || input.id) || createId('encounterevent'),
    encounterId,
    eventType: normalizeOptionalText(input.eventType || input.type) || 'note',
    sourceText: normalizeOptionalText(input.sourceText || input.text || input.content),
    summary: normalizeOptionalText(input.summary || input.description) || normalizeOptionalText(input.sourceText) || 'Encounter event',
    sceneId: normalizeOptionalText(input.sceneId),
    linkedActionId: normalizeOptionalText(input.linkedActionId),
    linkedNpcIds: normalizeStringArray(input.linkedNpcIds || input.npcIds),
    linkedFactionIds: normalizeStringArray(input.linkedFactionIds || input.factionIds),
    stateUpdates: normalizeStateUpdates(input.stateUpdates || input.updates),
    pressureDelta: normalizeInteger(input.pressureDelta ?? 0, 'pressureDelta'),
    budgetSpent: normalizeNonNegativeInteger(input.budgetSpent ?? 0, 'budgetSpent'),
    tickType: normalizeOptionalTickType(input.tickType),
    metadata: normalizeObject(input.metadata),
    createdAtIso: normalizeOptionalText(input.createdAtIso) || timestamp
  };
}

export function normalizeEncounterTick(input = {}, { encounter, sourceText = '' } = {}) {
  assertNoForbiddenRouteFields(input);
  const tickType = normalizeTickType(input.tickType || input.type || input.kind);
  const budgetSpent = normalizeNonNegativeInteger(input.budgetSpent ?? (tickType === 'conclusion' || tickType === 'reward' ? 0 : 1), 'budgetSpent');
  const remaining = Math.max(0, Number(encounter?.budgetRemaining || 0) - budgetSpent);
  const mustConcludeNow = Boolean(input.mustConcludeNow || remaining <= 0 || encounter?.resolutionPressure === 'forceCheck');
  const normalized = {
    tickType,
    summary: normalizeOptionalText(input.summary || input.reason || input.description) || defaultTickSummary(tickType, sourceText),
    stateUpdates: normalizeStateUpdates(input.stateUpdates || input.updates),
    pressureDelta: normalizeInteger(input.pressureDelta ?? (tickType === 'setback' ? 1 : 0), 'pressureDelta'),
    budgetSpent,
    mustConcludeNow,
    encounterStatus: input.encounterStatus || input.status ? normalizeEncounterStatus(input.encounterStatus || input.status) : '',
    linkedNpcIds: normalizeStringArray(input.linkedNpcIds || input.npcIds),
    linkedFactionIds: normalizeStringArray(input.linkedFactionIds || input.factionIds),
    metadata: normalizeObject(input.metadata)
  };
  if (mustConcludeNow && !['conclusion', 'reward', 'combat', 'setback'].includes(normalized.tickType) && !normalized.encounterStatus) {
    normalized.metadata.warning = 'Encounter budget is exhausted; next GM output should conclude, resolve, fail, escape, or force an explicit risk check.';
  }
  return normalized;
}

export function normalizeEncounterOutcome(input = {}, encounter = {}) {
  assertNoForbiddenRouteFields(input);
  const resolved = Boolean(input.resolved ?? input.success ?? false);
  const failed = Boolean(input.failed ?? false);
  const escaped = Boolean(input.escaped ?? false);
  let status = normalizeOptionalText(input.status);
  if (status) status = normalizeEncounterStatus(status);
  if (!status && resolved) status = 'resolved';
  if (!status && failed) status = 'failed';
  if (!status && escaped) status = 'escaped';
  if (!status) status = encounter.status || 'engaged';
  const consequenceEligible = Boolean(input.consequenceEligible ?? (status === 'failed' || status === 'escaped' && failed));
  return {
    encounterId: encounter.encounterId,
    resolved,
    failed,
    escaped,
    status,
    reason: normalizeOptionalText(input.reason || input.summary) || (resolved ? 'Encounter resolved.' : 'Encounter remains unresolved.'),
    stateUpdates: normalizeStateUpdates(input.stateUpdates || input.updates),
    rewardEligible: Boolean(input.rewardEligible ?? resolved),
    consequenceEligible,
    confidence: clampNumber(input.confidence ?? 0.5, 0, 1),
    metadata: normalizeObject(input.metadata)
  };
}

export function normalizeLuck(input = {}) {
  const source = normalizeObject(input);
  if (source.tier || source.luckTier) {
    const tier = normalizeLuckTier(source.tier || source.luckTier);
    return {
      tier,
      score: normalizeNullableNumber(source.score ?? source.luckScore ?? tierScore(tier), 'luckScore'),
      reason: normalizeOptionalText(source.reason) || `explicit tier: ${tier}`,
      source
    };
  }
  const outcome = normalizeOptionalText(source.outcome || source.result);
  if (outcome) {
    if (/criticalSuccess|critical_success|nat20|大成功/i.test(outcome)) return luckResult('exceptional', 100, `outcome=${outcome}`, source);
    if (/criticalFailure|critical_failure|nat1|大失败/i.test(outcome)) return luckResult('dire', 0, `outcome=${outcome}`, source);
    if (/success|成功/i.test(outcome)) return luckResult('favorable', 75, `outcome=${outcome}`, source);
    if (/failure|失败/i.test(outcome)) return luckResult('poor', 25, `outcome=${outcome}`, source);
  }
  const total = firstFiniteNumber(source.total, source.value, source.luckTotal);
  const dc = firstFiniteNumber(source.dc, source.difficultyClass, source.threshold, source.successThreshold);
  if (total !== undefined && dc !== undefined) {
    const margin = total - dc;
    if (margin >= 10) return luckResult('exceptional', 90, `margin ${margin} >= 10`, { ...source, margin });
    if (margin >= 0) return luckResult('favorable', 70, `margin ${margin} >= 0`, { ...source, margin });
    if (margin > -5) return luckResult('mixed', 50, `margin ${margin} > -5`, { ...source, margin });
    if (margin > -10) return luckResult('poor', 25, `margin ${margin} > -10`, { ...source, margin });
    return luckResult('dire', 5, `margin ${margin} <= -10`, { ...source, margin });
  }
  const score = firstFiniteNumber(source.score, source.luckScore, source.percent);
  if (score !== undefined) {
    const normalizedScore = clampNumber(score, 0, 100);
    return luckResult(scoreToLuckTier(normalizedScore), normalizedScore, `score=${normalizedScore}`, source);
  }
  const roll = firstFiniteNumber(source.roll, source.luckRoll);
  if (roll !== undefined && roll >= 0 && roll <= 1) {
    const scoreFromRoll = Math.round(roll * 100);
    return luckResult(scoreToLuckTier(scoreFromRoll), scoreFromRoll, `roll=${roll}`, source);
  }
  return luckResult('mixed', 50, 'no luck input supplied', source);
}

export function buildEncounterCreatePrompt({
  triggerResult = {},
  luck = {},
  sceneContext = '',
  mapContext = '',
  npcContext = '',
  partyContext = '',
  sourceText = '',
  referenceTemplate = '',
  userRules = '',
  activeEncounters = []
} = {}) {
  return [
    'Create one already-triggered tabletop RPG encounter.',
    '',
    'Hard rules:',
    ...ENCOUNTER_RULES.map((rule) => `- ${rule}`),
    '- Return a concrete event that is present now. Do not write it as a rumor the player may accept.',
    '- If you introduce combat, write stakes and setup only; do not apply damage or penalties here.',
    '- If the encounter reveals a rumor or quest hook, include it as rewardHints/stateFacts/openQuestions, not as encounter status=rumor.',
    '- Include one route-free objective and 1-3 resolutionCriteria so the encounter can converge.',
    '',
    'Luck assessment:',
    JSON.stringify(luck, null, 2),
    '',
    'Trigger result:',
    JSON.stringify(triggerResult, null, 2),
    '',
    'Active encounters to avoid duplicating:',
    JSON.stringify(activeEncounters, null, 2),
    '',
    'Scene context:',
    sceneContext || '(none)',
    '',
    'Map context:',
    mapContext || '(none)',
    '',
    'NPC context:',
    npcContext || '(none)',
    '',
    'Party context:',
    partyContext || '(none)',
    '',
    'Recent/source text:',
    sourceText || '(none)',
    '',
    'User reference template:',
    referenceTemplate || '(none)',
    '',
    'User rules:',
    userRules || '(none)',
    '',
    'Return JSON only with: encounterId, title, status, sceneId, encounterType, entryText, immediateSituation, objective, resolutionCriteria, stateFacts, openQuestions, involvedNpcIds, involvedFactionIds, locations, difficultyHint, riskHint, rewardHints, failureImpact, resolutionBudget, metadata.'
  ].join('\n');
}

export function buildEncounterTickPrompt({ encounter, sourceText = '', sceneContext = '', recentEvents = [], userRules = '' } = {}) {
  return [
    'Resolve exactly one progress tick for this already-triggered encounter.',
    '',
    'Hard convergence rules:',
    ...ENCOUNTER_RULES.map((rule) => `- ${rule}`),
    '- Output tickType as exactly one of: clue, state_change, choice, combat, reward, setback, conclusion.',
    '- setback is only allowed if it follows failed action/combat/outcome or explicit risky player choice.',
    '- Do not merely add another place, clue, stranger, or object. Spend budget and make the situation converge.',
    '- If budgetRemaining is 0 or becomes 0, set mustConcludeNow=true and prefer conclusion/resolved/failed/escaped over expansion.',
    '',
    'Encounter:',
    JSON.stringify(encounter, null, 2),
    '',
    'Recent encounter events:',
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
    'Return JSON only with: tickType, summary, stateUpdates, pressureDelta, budgetSpent, mustConcludeNow, encounterStatus, linkedNpcIds, linkedFactionIds, metadata.'
  ].join('\n');
}

export function buildEncounterOutcomePrompt({ encounter, sourceText = '', sceneContext = '', recentEvents = [], userRules = '' } = {}) {
  return [
    'Judge whether this already-triggered encounter is resolved, failed, escaped, or still engaged.',
    '',
    'Rules:',
    '- Judge outcome, not route compliance.',
    '- Reward eligibility requires successful resolution or a meaningful partial success.',
    '- Consequence eligibility requires failed action, failed combat, failed objective, escape with unresolved stakes, or explicit risky choice.',
    '- Never mark a consequence eligible merely because the encounter happened.',
    '',
    'Encounter:',
    JSON.stringify(encounter, null, 2),
    '',
    'Recent encounter events:',
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
    'Return JSON only with: resolved, failed, escaped, status, reason, stateUpdates, rewardEligible, consequenceEligible, confidence, metadata.'
  ].join('\n');
}

export function buildEncounterRewardPrompt({ encounter, outcome = {}, processSummary = '', userRules = '' } = {}) {
  return [
    'Plan a fair reward for a resolved RPG encounter.',
    '',
    'Consider luck tier, encounter difficulty, risk actually taken, player process, collateral damage, and encounter rewardHints.',
    'Rewards can be money, item, ally, clue, rumor, map access, faction shift, status, comedy, or future opportunity.',
    '',
    'Encounter:',
    JSON.stringify(encounter, null, 2),
    '',
    'Outcome:',
    JSON.stringify(outcome, null, 2),
    '',
    'Process summary:',
    processSummary || '(none)',
    '',
    'User rules:',
    userRules || '(none)',
    '',
    'Return JSON only with: rewardTier, rewards, withheldRewards, followUps, rationale.'
  ].join('\n');
}

export function buildEncounterConsequencePrompt({ encounter, failure = {}, userRules = '' } = {}) {
  return [
    'Plan proportional consequences for a failed RPG encounter.',
    '',
    'Hard rule: the encounter trigger itself never causes punishment. Consequences are only from failed action, failed combat, failed objective, escape with unresolved stakes, or explicit risky player choice.',
    'Small encounters can simply end with no consequence. Major failures can affect NPC, faction, map, clock, or future encounter state.',
    '',
    'Encounter:',
    JSON.stringify(encounter, null, 2),
    '',
    'Failure/outcome event:',
    JSON.stringify(failure, null, 2),
    '',
    'User rules:',
    userRules || '(none)',
    '',
    'Return JSON only with: consequenceTier, immediateEffects, delayedEffects, affectedNpcs, affectedFactions, affectedLocations, rationale.'
  ].join('\n');
}

function findExistingEncounter(manager, collection, input = {}) {
  if (input.id) return manager.getRecord(collection, input.id, { missing: 'undefined' });
  if (input.encounterId) return manager.getRecord(collection, encounterRecordId(input.encounterId), { missing: 'undefined' });
  return undefined;
}

function applyEncounterEventToRecord(encounter, event, { now = () => new Date().toISOString(), autoResolve = true } = {}) {
  const timestamp = now();
  const next = {
    ...encounter,
    resolutionCriteria: normalizeResolutionCriteria(encounter.resolutionCriteria),
    stateFacts: normalizeStringArray(encounter.stateFacts),
    openQuestions: normalizeStringArray(encounter.openQuestions),
    encounterUpdatedAt: timestamp
  };
  for (const update of normalizeStateUpdates(event.stateUpdates)) {
    applyStateUpdate(next, update);
  }
  if (event.budgetSpent > 0) {
    next.budgetRemaining = Math.max(0, Number(next.budgetRemaining || 0) - Number(event.budgetSpent || 0));
  }
  if (event.pressureDelta) {
    next.resolutionPressure = advancePressure(next.resolutionPressure, event.pressureDelta);
  }
  const requestedStatus = normalizeOptionalText(event.metadata?.encounterStatus);
  if (requestedStatus) next.status = normalizeEncounterStatus(requestedStatus);
  return deriveEncounterStatusAfterProgress(next, { autoResolve });
}

function applyStateUpdate(encounter, update) {
  if (update.value && ['fact', 'state', 'clue', 'reward', 'consequence'].includes(update.kind)) {
    encounter.stateFacts = appendUnique(encounter.stateFacts, String(update.value));
  }
  if (update.openQuestion) {
    encounter.openQuestions = appendUnique(encounter.openQuestions, String(update.openQuestion));
  }
  const criterionId = update.criterionId || update.slotId || update.id;
  if (criterionId) {
    let criterion = encounter.resolutionCriteria.find((candidate) => candidate.id === criterionId);
    if (!criterion) {
      criterion = {
        id: criterionId,
        text: update.description || update.value || 'New resolution criterion',
        required: false,
        status: 'open',
        value: '',
        notes: []
      };
      encounter.resolutionCriteria.push(criterion);
    }
    criterion.status = update.status || criterion.status;
    if (update.value !== undefined) criterion.value = update.value;
    if (update.description) criterion.text = update.description;
    if (update.note) criterion.notes = appendUnique(normalizeStringArray(criterion.notes), update.note);
    criterion.updatedAt = new Date().toISOString();
  }
}

function deriveEncounterStatusAfterProgress(encounter, { autoResolve = true } = {}) {
  if (!autoResolve || !ACTIVE_ENCOUNTER_STATUSES.has(encounter.status)) return encounter;
  const required = normalizeResolutionCriteria(encounter.resolutionCriteria).filter((criterion) => criterion.required);
  if (required.length > 0 && required.every((criterion) => ['resolved', 'satisfied', 'complete'].includes(criterion.status))) {
    return { ...encounter, status: 'resolved' };
  }
  if (Number(encounter.budgetRemaining || 0) <= 0 && ['none', 'low'].includes(encounter.resolutionPressure)) {
    return { ...encounter, resolutionPressure: 'high' };
  }
  return encounter;
}

function normalizeResolutionCriteria(value) {
  const items = normalizeArray(value);
  return items.map((item, index) => {
    if (typeof item === 'string') {
      return {
        id: `criterion_${index + 1}`,
        text: item,
        required: true,
        status: 'open',
        value: '',
        notes: []
      };
    }
    const object = normalizeObject(item);
    return {
      id: normalizeOptionalText(object.id || object.criterionId || object.name) || `criterion_${index + 1}`,
      text: normalizeOptionalText(object.text || object.description || object.value) || `Criterion ${index + 1}`,
      required: Boolean(object.required ?? true),
      status: normalizeCriterionStatus(object.status || object.state || 'open'),
      value: object.value ?? '',
      notes: normalizeStringArray(object.notes),
      metadata: normalizeObject(object.metadata)
    };
  });
}

function normalizeStateUpdates(value) {
  return normalizeArray(value).map((item, index) => {
    if (typeof item === 'string') {
      return {
        id: `update_${index + 1}`,
        kind: 'fact',
        value: item,
        status: '',
        criterionId: '',
        description: '',
        note: ''
      };
    }
    const object = normalizeObject(item);
    return {
      id: normalizeOptionalText(object.id || object.updateId) || `update_${index + 1}`,
      kind: normalizeOptionalText(object.kind || object.type) || 'fact',
      value: object.value ?? object.text ?? object.fact ?? '',
      status: object.status || object.state ? normalizeCriterionStatus(object.status || object.state) : '',
      criterionId: normalizeOptionalText(object.criterionId || object.slotId || object.criterion),
      description: normalizeOptionalText(object.description),
      openQuestion: normalizeOptionalText(object.openQuestion),
      note: normalizeOptionalText(object.note || object.reason),
      metadata: normalizeObject(object.metadata)
    };
  });
}

function normalizeCriterionStatus(value) {
  const normalized = String(value || 'open').trim();
  if (['open', 'partial', 'resolved', 'failed', 'satisfied', 'complete'].includes(normalized)) return normalized;
  const lower = normalized.toLowerCase();
  if (['done', 'filled', 'success'].includes(lower)) return 'resolved';
  if (['bad', 'failure'].includes(lower)) return 'failed';
  throw validationError(`Unsupported resolution criterion status: ${value}`);
}

function defaultEncounter(input = {}, luck = normalizeLuck(input)) {
  const seed = normalizeOptionalText(input.sourceText || input.text || input.content) || 'A chance encounter interrupts the current scene.';
  const encounterType = defaultEncounterType(luck.tier);
  return {
    title: input.title || seed.slice(0, 48),
    encounterType,
    entryText: seed,
    immediateSituation: input.immediateSituation || seed,
    objective: input.objective || defaultObjectiveForType(encounterType),
    resolutionCriteria: input.resolutionCriteria || [`Resolve the immediate ${encounterType} situation without free punishment.`],
    stateFacts: input.stateFacts || [],
    openQuestions: input.openQuestions || [],
    difficultyHint: input.difficultyHint || (luck.tier === 'dire' ? 'hard' : luck.tier === 'exceptional' ? 'easy' : 'moderate'),
    riskHint: input.riskHint || (['dire', 'poor'].includes(luck.tier) ? 'risk if mishandled' : 'low immediate risk'),
    rewardHints: input.rewardHints || defaultRewardHints(luck.tier, encounterType),
    failureImpact: input.failureImpact || { note: 'Only after failed action, failed combat, failed objective, or explicit risky choice.' },
    resolutionBudget: input.resolutionBudget || defaultResolutionBudget({ encounterType })
  };
}

function defaultEncounterTick(encounter = {}) {
  return {
    tickType: Number(encounter.budgetRemaining || 0) <= 1 ? 'conclusion' : 'state_change',
    summary: Number(encounter.budgetRemaining || 0) <= 1
      ? 'Encounter budget is exhausted; force a conclusion, resolution, failure, or escape.'
      : 'No LLM/tick was supplied; return an editable state-change tick instead of expanding endlessly.',
    budgetSpent: Number(encounter.budgetRemaining || 0) <= 1 ? 0 : 1,
    mustConcludeNow: Number(encounter.budgetRemaining || 0) <= 1,
    pressureDelta: 1
  };
}

function defaultEncounterOutcome(encounter = {}) {
  return {
    resolved: false,
    failed: false,
    escaped: false,
    status: encounter.status || 'engaged',
    reason: 'No outcome decision supplied.',
    rewardEligible: false,
    consequenceEligible: false,
    confidence: 0.5
  };
}

function defaultEncounterRewardPlan(encounter = {}) {
  return {
    encounterId: encounter.encounterId,
    rewardTier: encounter.luckTier === 'exceptional' ? 'major' : encounter.luckTier === 'favorable' ? 'moderate' : 'minor',
    rewards: normalizeArray(encounter.rewardHints),
    withheldRewards: [],
    followUps: [],
    rationale: 'Template reward plan; use LLM or user-supplied plan for final rewards.'
  };
}

function defaultEncounterConsequencePlan(encounter = {}) {
  return {
    encounterId: encounter.encounterId,
    consequenceTier: encounter.riskHint || 'minor',
    immediateEffects: [],
    delayedEffects: normalizeArray(encounter.failureImpact?.delayedEffects),
    affectedNpcs: normalizeStringArray(encounter.involvedNpcIds),
    affectedFactions: normalizeStringArray(encounter.involvedFactionIds),
    affectedLocations: normalizeStringArray(encounter.locations),
    rationale: 'Template consequence plan; only apply after failed action, failed combat, failed objective, or explicit risky choice.'
  };
}

function normalizeEncounterRewardPlan(input = {}, encounter = {}) {
  return {
    encounterId: encounter.encounterId,
    rewardTier: normalizeOptionalText(input.rewardTier || input.tier) || 'minor',
    rewards: normalizeArray(input.rewards),
    loot: normalizeArray(input.loot),
    currency: normalizeObject(input.currency),
    withheldRewards: normalizeArray(input.withheldRewards),
    followUps: normalizeArray(input.followUps || input.complications),
    toolCalls: normalizeArray(input.toolCalls || input.effectEnvelope?.toolCalls),
    effectEnvelope: normalizeObject(input.effectEnvelope),
    rationale: normalizeOptionalText(input.rationale || input.reason) || ''
  };
}

function normalizeEncounterConsequencePlan(input = {}, encounter = {}) {
  return {
    encounterId: encounter.encounterId,
    consequenceTier: normalizeOptionalText(input.consequenceTier || input.tier) || 'minor',
    immediateEffects: normalizeArray(input.immediateEffects),
    delayedEffects: normalizeArray(input.delayedEffects),
    affectedNpcs: normalizeStringArray(input.affectedNpcs || input.npcIds),
    affectedFactions: normalizeStringArray(input.affectedFactions || input.factionIds),
    affectedLocations: normalizeStringArray(input.affectedLocations || input.locations),
    toolCalls: normalizeArray(input.toolCalls || input.effectEnvelope?.toolCalls),
    effectEnvelope: normalizeObject(input.effectEnvelope),
    rationale: normalizeOptionalText(input.rationale || input.reason) || ''
  };
}

function normalizeEncounterRewardItems(value = []) {
  return normalizeArray(value)
    .flatMap((entry) => {
      if (entry === undefined || entry === null || entry === '') return [];
      if (typeof entry === 'string') return [{ id: safeSegment(entry), name: entry, quantity: 1, metadata: { rewardKind: 'loot' } }];
      if (typeof entry === 'number') return [];
      const object = normalizeObject(entry);
      const kind = normalizeOptionalText(object.kind || object.type || object.category).toLowerCase();
      if (kind === 'currency' || object.currency) return [];
      const name = normalizeOptionalText(object.name || object.title || object.itemName || object.summary || object.id);
      if (!name) return [];
      return [{
        id: safeSegment(object.id || object.itemId || object.resourceId || name),
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

function normalizeEncounterRewardCurrency(values = []) {
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

function mergeEncounterRewardInventory(current = {}, rewards = {}) {
  const base = normalizeInventoryShape(current);
  const currency = { ...base.currency };
  for (const [key, amount] of Object.entries(normalizeObject(rewards.currency))) {
    const number = Number(amount);
    if (!Number.isFinite(number)) continue;
    currency[safeSegment(key)] = (Number(currency[safeSegment(key)]) || 0) + number;
  }
  const byId = new Map(base.items.map((item) => [safeSegment(item.id || item.name), { ...item }]));
  for (const item of normalizeEncounterRewardItems(rewards.items)) {
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

function normalizeEncounterToolCalls(plan = {}, defaults = {}) {
  const source = normalizeObject(plan);
  const calls = [
    ...normalizeArray(source.toolCalls),
    ...normalizeArray(source.effectEnvelope?.toolCalls),
    ...normalizeArray(source.followUps).filter((item) => normalizeObject(item).tool || normalizeObject(item).toolId),
    ...normalizeArray(source.immediateEffects).filter((item) => normalizeObject(item).tool || normalizeObject(item).toolId),
    ...normalizeArray(source.delayedEffects).filter((item) => normalizeObject(item).tool || normalizeObject(item).toolId)
  ];
  return calls
    .map((call, index) => normalizeEncounterToolCall(call, defaults, index))
    .filter(Boolean);
}

function normalizeEncounterToolCall(call = {}, defaults = {}, index = 0) {
  const source = normalizeObject(call);
  const tool = normalizeOptionalText(source.tool || source.toolId || source.name);
  if (!tool) return undefined;
  if (defaults.phase === 'reward' && tool === 'system.npc_state.patch_state') return undefined;
  const sourceInput = normalizeObject(source.input || source.args || source.parameters);
  const input = {
    ...sourceInput,
    chatSessionId: sourceInput.chatSessionId || source.chatSessionId || defaults.chatSessionId,
    sceneId: sourceInput.sceneId || source.sceneId || defaults.sceneId,
    source: sourceInput.source || source.source || `encounter-${defaults.phase || 'impact'}`
  };
  return {
    id: normalizeOptionalText(source.id || source.callId) || `encounter_${defaults.phase || 'impact'}_tool_${index + 1}`,
    tool,
    input: removeUndefined(input),
    reason: normalizeOptionalText(source.reason || source.summary || source.description)
  };
}

async function generateEncounterJson({ chatProvider, prompt, system, temperature, maxTokens, missingMessage }) {
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

function encounterRecordId(encounterId) {
  const id = normalizeRequiredText(encounterId, 'encounterId');
  return id.startsWith('encounter_') ? id : `encounter_${id}`;
}

function encounterEventRecordId(encounterId, eventId) {
  return `${encounterRecordId(encounterId)}_${normalizeRequiredText(eventId, 'eventId')}`;
}

function defaultResolutionBudget(input = {}) {
  const type = normalizeOptionalText(input.encounterType || input.type);
  if (type === 'combat') return 3;
  if (type === 'discovery' || type === 'rumor') return 3;
  if (type === 'reward') return 1;
  return 2;
}

function defaultEncounterType(luckTier) {
  if (luckTier === 'exceptional') return 'reward';
  if (luckTier === 'favorable') return 'discovery';
  if (luckTier === 'dire') return 'combat';
  if (luckTier === 'poor') return 'environment';
  return 'mixed';
}

function defaultObjectiveForType(type) {
  if (type === 'combat') return 'Survive or defuse the combat encounter.';
  if (type === 'reward') return 'Claim or understand the opportunity without creating new risk.';
  if (type === 'rumor') return 'Identify what information the encounter reveals.';
  if (type === 'discovery') return 'Understand and safely use the discovery.';
  return 'Resolve the immediate encounter.';
}

function defaultRewardHints(luckTier, encounterType) {
  if (luckTier === 'exceptional') return ['valuable clue', 'unexpected ally', 'rare opportunity'];
  if (luckTier === 'favorable') return ['useful clue', 'safe shortcut', 'minor reward'];
  if (encounterType === 'combat') return ['loot or information if combat is won'];
  return ['information if handled well'];
}

function normalizeEncounterStatus(value, field = 'status') {
  const normalized = String(value || '').trim();
  if (ENCOUNTER_STATUSES.has(normalized)) return normalized;
  throw validationError(`${field} must be one of: ${[...ENCOUNTER_STATUSES].join(', ')}`);
}

function normalizeEncounterType(value) {
  const normalized = String(value || 'mixed').trim();
  if (ENCOUNTER_TYPES.has(normalized)) return normalized;
  throw validationError(`encounterType must be one of: ${[...ENCOUNTER_TYPES].join(', ')}`);
}

function normalizeTickType(value) {
  const normalized = String(value || '').trim();
  if (ENCOUNTER_TICK_TYPES.has(normalized)) return normalized;
  throw validationError(`tickType must be one of: ${[...ENCOUNTER_TICK_TYPES].join(', ')}`);
}

function normalizeOptionalTickType(value) {
  if (!value) return '';
  return normalizeTickType(value);
}

function normalizePressure(value) {
  const normalized = String(value || 'none').trim();
  if (ENCOUNTER_PRESSURE.includes(normalized)) return normalized;
  const lower = normalized.toLowerCase();
  if (lower === 'forcecheck' || lower === 'force_check') return 'forceCheck';
  throw validationError(`resolutionPressure must be one of: ${ENCOUNTER_PRESSURE.join(', ')}`);
}

function advancePressure(current, delta) {
  const index = ENCOUNTER_PRESSURE.indexOf(normalizePressure(current || 'none'));
  const nextIndex = clampNumber(index + Number(delta || 0), 0, ENCOUNTER_PRESSURE.length - 1);
  return ENCOUNTER_PRESSURE[nextIndex];
}

function normalizeLuckTier(value) {
  const normalized = String(value || 'mixed').trim();
  if (LUCK_TIERS.includes(normalized)) return normalized;
  const lower = normalized.toLowerCase();
  if (['bad', 'unlucky', 'critical_failure', 'criticalfailure'].includes(lower)) return 'dire';
  if (['low', 'failure'].includes(lower)) return 'poor';
  if (['neutral', 'normal'].includes(lower)) return 'mixed';
  if (['good', 'success'].includes(lower)) return 'favorable';
  if (['great', 'lucky', 'critical_success', 'criticalsuccess'].includes(lower)) return 'exceptional';
  throw validationError(`luckTier must be one of: ${LUCK_TIERS.join(', ')}`);
}

function scoreToLuckTier(score) {
  if (score >= 90) return 'exceptional';
  if (score >= 65) return 'favorable';
  if (score >= 40) return 'mixed';
  if (score >= 15) return 'poor';
  return 'dire';
}

function tierScore(tier) {
  return {
    dire: 5,
    poor: 25,
    mixed: 50,
    favorable: 75,
    exceptional: 95
  }[tier] ?? 50;
}

function luckResult(tier, score, reason, source) {
  return {
    tier,
    score,
    reason,
    source
  };
}

function defaultTickSummary(tickType, sourceText) {
  if (sourceText) return sourceText;
  return `Encounter tick: ${tickType}`;
}

function assertNoForbiddenRouteFields(input = {}) {
  const forbidden = [
    'requiredSteps',
    'stepChain',
    'mandatoryRoute',
    'mustTalkTo',
    'mustVisit',
    'fetchChain',
    'requiredNpc',
    'requiredLocation',
    'nextRequiredStep'
  ];
  const lowerKeys = new Set(Object.keys(input || {}).map((key) => key.toLowerCase()));
  const matched = forbidden.filter((key) => lowerKeys.has(key.toLowerCase()));
  if (matched.length) throw validationError(`Forbidden route fields in encounter record: ${matched.join(', ')}`);
}

function slugId(value, fallbackPrefix = 'id') {
  const source = String(value || '').trim().toLowerCase();
  const slug = source
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return slug || createId(fallbackPrefix);
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

function normalizeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value };
}

function normalizeArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeStringArray(value) {
  return normalizeArray(value).map((item) => String(item || '').trim()).filter(Boolean);
}

function normalizeInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number)) throw validationError(`${field} must be an integer`);
  return number;
}

function normalizeNonNegativeInteger(value, field) {
  const number = normalizeInteger(value, field);
  if (number < 0) throw validationError(`${field} must be >= 0`);
  return number;
}

function normalizeNullableNumber(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw validationError(`${field} must be a finite number`);
  return number;
}

function normalizeBooleanInteger(value) {
  return value ? 1 : 0;
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

function appendUnique(list, value) {
  const next = [...list];
  if (!next.includes(value)) next.push(value);
  return next;
}

function safeSegment(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9_.\-\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 160) || 'item';
}

function removeUndefined(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined));
}

async function safeExecuteTool(toolManager, tool, input) {
  if (!toolManager || typeof toolManager.executeTool !== 'function') {
    return {
      ok: false,
      error: { name: 'MissingToolManager', message: 'EncounterManager has no toolManager' }
    };
  }
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

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    statusCode: error?.statusCode,
    stack: error?.stack
  };
}

function normalizeSearchText(value) {
  return String(value || '').toLowerCase().trim();
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'ValidationError';
  error.statusCode = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.name = 'NotFoundError';
  error.statusCode = 404;
  return error;
}
