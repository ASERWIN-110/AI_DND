// @ts-nocheck
import { QuestManager } from '../quests/quest-manager.js';

export const QUEST_PLUGIN = {
  id: 'system.quests',
  name: 'Quest System Tools',
  version: '0.1.0',
  description: 'Open-ended tabletop quest tools: hook writing, tracking, investigation convergence, completion checks, rewards, consequences, deadlines, import/export, and traceable debug files.',
  enabled: true,
  permissions: ['quests:read', 'quests:write', 'quests:llm'],
  tools: [
    {
      name: 'describe_db',
      title: 'Describe Quest Database',
      description: 'Describe chat-local quest collections, statuses, anti-railroad rules, and prompt templates.',
      inputSchema: chatSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['quest', 'schema', 'templates']
    },
    {
      name: 'create_hook',
      title: 'Create Quest Hook',
      description: 'Create or normalize an open-ended quest hook with objective, success criteria, evidence slots, and no fixed route chain. Defaults to writing the rumor unless dryRun=true.',
      inputSchema: createHookSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        writesTrace: true
      },
      tags: ['quest', 'hook', 'llm', 'write']
    },
    {
      name: 'gate_relevance',
      title: 'Gate Quest Relevance',
      description: 'Decide which active quests are affected by new text before running investigation or completion checks.',
      inputSchema: relevanceSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['quest', 'relevance', 'llm']
    },
    {
      name: 'resolve_investigation_tick',
      title: 'Resolve Investigation Tick',
      description: 'Resolve one relevant investigation tick as evidence, exclusion, risk, or conclusion. Defaults to dryRun=true for editable middle files.',
      inputSchema: investigationTickSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        writesTrace: true
      },
      tags: ['quest', 'investigation', 'convergence', 'llm']
    },
    {
      name: 'check_completion',
      title: 'Check Quest Completion',
      description: 'Judge whether a player approach satisfied the quest objective. It checks outcome, not route compliance. Defaults to dryRun=true.',
      inputSchema: completionSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        writesTrace: true
      },
      tags: ['quest', 'completion', 'llm']
    },
    {
      name: 'plan_reward',
      title: 'Plan Quest Reward',
      description: 'Plan proportional rewards from difficulty, risk, process, patron resources, and completion quality.',
      inputSchema: rewardSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['quest', 'reward', 'llm']
    },
    {
      name: 'plan_consequence',
      title: 'Plan Quest Consequence',
      description: 'Plan proportional consequences for failed, expired, abandoned, or ignored quests.',
      inputSchema: consequenceSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['quest', 'consequence', 'llm']
    },
    {
      name: 'upsert_quest',
      title: 'Upsert Quest',
      description: 'Create or replace a quest record. The manager rejects route-chain fields such as requiredSteps and mandatoryRoute.',
      inputSchema: questRecordSchema({ required: ['chatSessionId'] }),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['quest', 'record', 'write']
    },
    {
      name: 'patch_quest',
      title: 'Patch Quest',
      description: 'Patch one quest record by id or questId.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          id: { type: 'string' },
          questId: { type: 'string' },
          patch: { type: 'object', additionalProperties: true }
        },
        required: ['chatSessionId', 'patch'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['quest', 'record', 'write']
    },
    {
      name: 'get_quest',
      title: 'Get Quest',
      description: 'Get one quest by id or questId.',
      inputSchema: questIdentitySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['quest', 'query']
    },
    {
      name: 'list_quests',
      title: 'List Quests',
      description: 'List quest records in one chat.',
      inputSchema: listQuestsSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['quest', 'query']
    },
    {
      name: 'track_quest',
      title: 'Track Quest',
      description: 'Mark a rumor or dormant quest as tracked/reportable/etc. and add a quest event.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          id: { type: 'string' },
          questId: { type: 'string' },
          status: { type: 'string' },
          summary: { type: 'string' },
          sourceText: { type: 'string' },
          source: { type: 'string' }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['quest', 'track', 'write']
    },
    {
      name: 'set_quest_status',
      title: 'Set Quest Status',
      description: 'Set quest status and write an audit event.',
      inputSchema: statusSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['quest', 'status', 'write']
    },
    {
      name: 'archive_quest',
      title: 'Archive Quest',
      description: 'Archive a quest record without deleting its history.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          id: { type: 'string' },
          questId: { type: 'string' },
          summary: { type: 'string' },
          sourceText: { type: 'string' },
          metadata: { type: 'object', additionalProperties: true }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['quest', 'archive', 'write']
    },
    {
      name: 'add_quest_event',
      title: 'Add Quest Event',
      description: 'Append a quest event and optionally apply evidence/progress updates to the quest record.',
      inputSchema: questEventSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['quest', 'event', 'write']
    },
    {
      name: 'list_quest_events',
      title: 'List Quest Events',
      description: 'List quest events by questId, type, or filter.',
      inputSchema: listEventsSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['quest', 'event', 'query']
    },
    {
      name: 'set_quest_clock',
      title: 'Set Quest Clock',
      description: 'Set a quest deadline by elapsed time, round, or scene end.',
      inputSchema: questClockSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['quest', 'clock', 'deadline', 'write']
    },
    {
      name: 'expire_due_quests',
      title: 'Expire Due Quests',
      description: 'Expire/fail/abandon active quests whose quest clocks are due. This is deterministic and does not use the LLM.',
      inputSchema: expireDueSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['quest', 'clock', 'expiry', 'write']
    },
    {
      name: 'import_quests',
      title: 'Import Quests',
      description: 'Import quest records, events, and clocks from JSON, YAML, or XML.',
      inputSchema: importSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['quest', 'import', 'json', 'yaml', 'xml']
    },
    {
      name: 'export_quests',
      title: 'Export Quests',
      description: 'Export quest records, events, and clocks as JSON or YAML.',
      inputSchema: exportSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['quest', 'export', 'json', 'yaml']
    }
  ]
};

export function createQuestHandlers({ appDatabase, manager, chatProvider, trace } = {}) {
  const quests = manager || new QuestManager({
    appDatabase,
    chatProvider,
    trace
  });
  return {
    describe_db: async ({ input }) => quests.describe(input.chatSessionId),
    create_hook: async ({ input }) => quests.createHook(input),
    gate_relevance: async ({ input }) => quests.gateRelevance(input),
    resolve_investigation_tick: async ({ input }) => quests.resolveInvestigationTick(input),
    check_completion: async ({ input }) => quests.checkCompletion(input),
    plan_reward: async ({ input }) => quests.planReward(input),
    plan_consequence: async ({ input }) => quests.planConsequence(input),
    upsert_quest: async ({ input }) => quests.upsertQuest(input),
    patch_quest: async ({ input }) => quests.patchQuest(input),
    get_quest: async ({ input }) => quests.getQuest(input),
    list_quests: async ({ input }) => quests.listQuests(input),
    track_quest: async ({ input }) => quests.trackQuest(input),
    set_quest_status: async ({ input }) => quests.setQuestStatus(input),
    archive_quest: async ({ input }) => quests.archiveQuest(input),
    add_quest_event: async ({ input }) => quests.addQuestEvent(input),
    list_quest_events: async ({ input }) => quests.listEvents(input),
    set_quest_clock: async ({ input }) => quests.setQuestClock(input),
    expire_due_quests: async ({ input }) => quests.expireDueQuests(input),
    import_quests: async ({ input }) => quests.importQuests(input),
    export_quests: async ({ input }) => quests.exportQuests(input)
  };
}

function chatSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function createHookSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      seedText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      sceneContext: { type: 'string' },
      context: { type: 'string' },
      userRules: { type: 'string' },
      rules: { type: 'string' },
      quest: { type: 'object', additionalProperties: true },
      hook: { type: 'object', additionalProperties: true },
      questRecord: { type: 'object', additionalProperties: true },
      title: { type: 'string' },
      objective: { type: 'string' },
      successCriteria: arraySchema(),
      evidenceSlots: arraySchema(),
      openLeads: arraySchema(),
      investigationBudget: { type: 'integer', minimum: 0 },
      dryRun: { type: 'boolean', default: false },
      useLlm: { type: 'boolean', default: false },
      temperature: { type: 'number' },
      maxTokens: { type: 'integer', minimum: 1, maximum: 12000 }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function relevanceSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      text: { type: 'string' },
      sourceText: { type: 'string' },
      content: { type: 'string' },
      sceneContext: { type: 'string' },
      context: { type: 'string' },
      userRules: { type: 'string' },
      rules: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      decision: { type: 'object', additionalProperties: true },
      relevance: { type: 'object', additionalProperties: true },
      useLlm: { type: 'boolean', default: false },
      temperature: { type: 'number' },
      maxTokens: { type: 'integer', minimum: 1, maximum: 12000 }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function investigationTickSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      questId: { type: 'string' },
      sceneId: { type: 'string' },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      sceneContext: { type: 'string' },
      context: { type: 'string' },
      userRules: { type: 'string' },
      rules: { type: 'string' },
      eventLimit: { type: 'integer', minimum: 1, maximum: 200 },
      linkedActionId: { type: 'string' },
      linkedSceneId: { type: 'string' },
      linkedNpcIds: stringArraySchema(),
      linkedFactionIds: stringArraySchema(),
      tick: { type: 'object', additionalProperties: true },
      decision: { type: 'object', additionalProperties: true },
      dryRun: { type: 'boolean', default: true },
      useLlm: { type: 'boolean', default: false },
      temperature: { type: 'number' },
      maxTokens: { type: 'integer', minimum: 1, maximum: 12000 }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function completionSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      questId: { type: 'string' },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      sceneContext: { type: 'string' },
      context: { type: 'string' },
      userRules: { type: 'string' },
      rules: { type: 'string' },
      eventLimit: { type: 'integer', minimum: 1, maximum: 200 },
      decision: { type: 'object', additionalProperties: true },
      completion: { type: 'object', additionalProperties: true },
      dryRun: { type: 'boolean', default: true },
      useLlm: { type: 'boolean', default: false },
      temperature: { type: 'number' },
      maxTokens: { type: 'integer', minimum: 1, maximum: 12000 }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function rewardSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      questId: { type: 'string' },
      completion: { type: 'object', additionalProperties: true },
      decision: { type: 'object', additionalProperties: true },
      processSummary: { type: 'string' },
      sourceText: { type: 'string' },
      userRules: { type: 'string' },
      rules: { type: 'string' },
      rewardPlan: { type: 'object', additionalProperties: true },
      plan: { type: 'object', additionalProperties: true },
      useLlm: { type: 'boolean', default: false },
      temperature: { type: 'number' },
      maxTokens: { type: 'integer', minimum: 1, maximum: 12000 }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function consequenceSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      questId: { type: 'string' },
      failureOrExpiry: { type: 'object', additionalProperties: true },
      event: { type: 'object', additionalProperties: true },
      userRules: { type: 'string' },
      rules: { type: 'string' },
      consequencePlan: { type: 'object', additionalProperties: true },
      plan: { type: 'object', additionalProperties: true },
      useLlm: { type: 'boolean', default: false },
      temperature: { type: 'number' },
      maxTokens: { type: 'integer', minimum: 1, maximum: 12000 }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function questRecordSchema({ required = [] } = {}) {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      questId: { type: 'string' },
      title: { type: 'string' },
      status: { type: 'string' },
      hookText: { type: 'string' },
      hook: { type: 'string' },
      objective: { type: 'string' },
      successCriteria: arraySchema(),
      criteria: arraySchema(),
      evidenceSlots: arraySchema(),
      knownFacts: arraySchema(),
      suspectedFacts: arraySchema(),
      openLeads: arraySchema(),
      leads: arraySchema(),
      stakeholders: arraySchema(),
      locations: arraySchema(),
      difficultyHint: { type: 'string' },
      riskHint: { type: 'string' },
      rewardHints: arraySchema(),
      rewards: arraySchema(),
      failureImpact: { type: 'object', additionalProperties: true },
      expiry: { type: 'object', additionalProperties: true },
      resolutionPressure: { type: 'string' },
      investigationBudget: { type: 'integer', minimum: 0 },
      budgetRemaining: { type: 'integer', minimum: 0 },
      deadEndCount: { type: 'integer', minimum: 0 },
      mustConcludeAt: { type: 'integer', minimum: 0 },
      antiRailroadRules: arraySchema(),
      metadata: { type: 'object', additionalProperties: true },
      createdAtIso: { type: 'string' },
      questUpdatedAt: { type: 'string' }
    },
    required,
    additionalProperties: false
  };
}

function questIdentitySchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      questId: { type: 'string' },
      missing: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function listQuestsSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      status: {
        oneOf: [
          { type: 'string' },
          stringArraySchema()
        ]
      },
      activeOnly: { type: 'boolean', default: false },
      query: { type: 'string' },
      filter: { type: 'object', additionalProperties: true },
      sort: arraySchema(),
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function statusSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      questId: { type: 'string' },
      status: { type: 'string' },
      eventType: { type: 'string' },
      summary: { type: 'string' },
      sourceText: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true }
    },
    required: ['chatSessionId', 'status'],
    additionalProperties: false
  };
}

function questEventSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      questRecordId: { type: 'string' },
      questId: { type: 'string' },
      id: { type: 'string' },
      eventId: { type: 'string' },
      eventType: { type: 'string' },
      type: { type: 'string' },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      summary: { type: 'string' },
      description: { type: 'string' },
      linkedActionId: { type: 'string' },
      linkedSceneId: { type: 'string' },
      sceneId: { type: 'string' },
      linkedNpcIds: stringArraySchema(),
      npcIds: stringArraySchema(),
      linkedFactionIds: stringArraySchema(),
      factionIds: stringArraySchema(),
      evidenceUpdates: arraySchema(),
      pressureDelta: { type: 'integer' },
      budgetSpent: { type: 'integer', minimum: 0 },
      tickType: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true },
      createdAtIso: { type: 'string' },
      applyToQuest: { type: 'boolean', default: true },
      autoReportable: { type: 'boolean', default: true }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function listEventsSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      questId: { type: 'string' },
      eventType: { type: 'string' },
      filter: { type: 'object', additionalProperties: true },
      sort: arraySchema(),
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function questClockSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      questId: { type: 'string' },
      status: { type: 'string' },
      expiresAtElapsedSeconds: { type: 'integer', minimum: 0 },
      expiresAtRound: { type: 'integer', minimum: 0 },
      expiresAtSceneEnd: { type: 'boolean' },
      expireMode: { type: 'string' },
      expiryImpact: { type: 'object', additionalProperties: true },
      createdAtIso: { type: 'string' },
      clockUpdatedAt: { type: 'string' }
    },
    required: ['chatSessionId', 'questId'],
    additionalProperties: false
  };
}

function expireDueSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      elapsedSeconds: { type: 'integer', minimum: 0 },
      roundNumber: { type: 'integer', minimum: 0 },
      sceneEnded: { type: 'boolean', default: false },
      includePaused: { type: 'boolean', default: false },
      clock: { type: 'object', additionalProperties: true },
      encounter: { type: 'object', additionalProperties: true },
      summary: { type: 'string' },
      source: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function importSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      text: { type: 'string' },
      format: { type: 'string', default: 'auto' },
      collection: { type: 'string' },
      collectionMap: { type: 'object', additionalProperties: true },
      idField: { type: 'string' }
    },
    required: ['chatSessionId', 'text'],
    additionalProperties: false
  };
}

function exportSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      format: { type: 'string', default: 'json' },
      includeEvents: { type: 'boolean', default: true },
      includeClocks: { type: 'boolean', default: true },
      status: {
        oneOf: [
          { type: 'string' },
          stringArraySchema()
        ]
      },
      activeOnly: { type: 'boolean', default: false }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function arraySchema() {
  return {
    type: 'array',
    items: {}
  };
}

function stringArraySchema() {
  return {
    type: 'array',
    items: { type: 'string' }
  };
}
