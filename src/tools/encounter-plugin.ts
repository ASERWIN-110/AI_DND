// @ts-nocheck
import { EncounterManager } from '../encounters/encounter-manager.js';

export const ENCOUNTER_PLUGIN = {
  id: 'system.encounters',
  name: 'Encounter System Tools',
  version: '0.1.0',
  description: 'Luck-based encounter tools for already-triggered events, LLM/template creation, convergence ticks, outcome checks, rewards, consequences, import/export, and traceable debug files.',
  enabled: true,
  permissions: ['encounters:read', 'encounters:write', 'encounters:llm'],
  tools: [
    {
      name: 'describe_db',
      title: 'Describe Encounter Database',
      description: 'Describe chat-local encounter collections, statuses, luck tiers, hard rules, and prompt templates.',
      inputSchema: chatSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['encounter', 'schema', 'templates']
    },
    {
      name: 'assess_luck',
      title: 'Assess Encounter Luck',
      description: 'Normalize dice/check/score/roll input into encounter luck tiers without mutating state.',
      inputSchema: luckSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['encounter', 'luck', 'deterministic']
    },
    {
      name: 'create_encounter',
      title: 'Create Encounter',
      description: 'Create an already-triggered encounter from luck, trigger result, scene context, and optional user template. Defaults to writing unless dryRun=true.',
      inputSchema: createEncounterSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['encounter', 'create', 'luck', 'llm', 'write']
    },
    {
      name: 'resolve_tick',
      title: 'Resolve Encounter Tick',
      description: 'Resolve one meaningful encounter tick while forcing convergence and preventing free punishment.',
      inputSchema: tickSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['encounter', 'progress', 'convergence', 'llm']
    },
    {
      name: 'check_outcome',
      title: 'Check Encounter Outcome',
      description: 'Judge whether the encounter resolved, failed, escaped, or remains engaged. Defaults to dryRun=true.',
      inputSchema: outcomeSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['encounter', 'outcome', 'llm']
    },
    {
      name: 'plan_reward',
      title: 'Plan Encounter Reward',
      description: 'Plan proportional rewards for a resolved encounter from luck, risk, process, and outcome.',
      inputSchema: rewardSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['encounter', 'reward', 'llm']
    },
    {
      name: 'plan_consequence',
      title: 'Plan Encounter Consequence',
      description: 'Plan proportional consequences only after failed action, failed combat, failed objective, escape, or explicit risky choice.',
      inputSchema: consequenceSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['encounter', 'consequence', 'llm']
    },
    {
      name: 'apply_reward',
      title: 'Apply Encounter Reward',
      description: 'Apply planned encounter rewards to an actor inventory and execute explicit reward tool calls.',
      inputSchema: applyRewardSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['encounter', 'reward', 'inventory', 'write']
    },
    {
      name: 'apply_consequence',
      title: 'Apply Encounter Consequence',
      description: 'Apply explicit consequence tool calls and record the consequence event. Consequences must come from a failed event, failed combat, failed objective, escape, or explicit risky choice.',
      inputSchema: applyConsequenceSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['encounter', 'consequence', 'impact', 'write']
    },
    {
      name: 'upsert_encounter',
      title: 'Upsert Encounter',
      description: 'Create or replace an encounter record. The manager rejects fixed-route fields and stores no free-punishment rule.',
      inputSchema: encounterRecordSchema({ required: ['chatSessionId'] }),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['encounter', 'record', 'write']
    },
    {
      name: 'patch_encounter',
      title: 'Patch Encounter',
      description: 'Patch one encounter record by id or encounterId.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          id: { type: 'string' },
          encounterId: { type: 'string' },
          patch: { type: 'object', additionalProperties: true }
        },
        required: ['chatSessionId', 'patch'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['encounter', 'record', 'write']
    },
    {
      name: 'get_encounter',
      title: 'Get Encounter',
      description: 'Get one encounter by id or encounterId.',
      inputSchema: encounterIdentitySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['encounter', 'query']
    },
    {
      name: 'list_encounters',
      title: 'List Encounters',
      description: 'List encounter records in one chat.',
      inputSchema: listEncountersSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['encounter', 'query']
    },
    {
      name: 'set_encounter_status',
      title: 'Set Encounter Status',
      description: 'Set encounter status and write an audit event.',
      inputSchema: statusSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['encounter', 'status', 'write']
    },
    {
      name: 'archive_encounter',
      title: 'Archive Encounter',
      description: 'Archive an encounter record without deleting its history.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          id: { type: 'string' },
          encounterId: { type: 'string' },
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
      tags: ['encounter', 'archive', 'write']
    },
    {
      name: 'add_event',
      title: 'Add Encounter Event',
      description: 'Append an encounter event and optionally apply state/progress updates to the encounter record.',
      inputSchema: encounterEventSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['encounter', 'event', 'write']
    },
    {
      name: 'list_events',
      title: 'List Encounter Events',
      description: 'List encounter events by encounterId, type, or filter.',
      inputSchema: listEventsSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['encounter', 'event', 'query']
    },
    {
      name: 'import_encounters',
      title: 'Import Encounters',
      description: 'Import encounter records and events from JSON, YAML, or XML.',
      inputSchema: importSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['encounter', 'import', 'json', 'yaml', 'xml']
    },
    {
      name: 'export_encounters',
      title: 'Export Encounters',
      description: 'Export encounter records and events as JSON or YAML.',
      inputSchema: exportSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['encounter', 'export', 'json', 'yaml']
    }
  ]
};

export function createEncounterHandlers({ appDatabase, manager, chatProvider, trace, toolManager } = {}) {
  const encounters = manager || new EncounterManager({
    appDatabase,
    chatProvider,
    trace,
    toolManager
  });
  if (manager && toolManager && !manager.toolManager) {
    manager.toolManager = toolManager;
  }
  return {
    describe_db: async ({ input }) => encounters.describe(input.chatSessionId),
    assess_luck: async ({ input }) => encounters.assessLuck(input),
    create_encounter: async ({ input }) => encounters.createEncounter(input),
    resolve_tick: async ({ input }) => encounters.resolveTick(input),
    check_outcome: async ({ input }) => encounters.checkOutcome(input),
    plan_reward: async ({ input }) => encounters.planReward(input),
    plan_consequence: async ({ input }) => encounters.planConsequence(input),
    apply_reward: async ({ input }) => encounters.applyReward(input),
    apply_consequence: async ({ input }) => encounters.applyConsequence(input),
    upsert_encounter: async ({ input }) => encounters.upsertEncounter(input),
    patch_encounter: async ({ input }) => encounters.patchEncounter(input),
    get_encounter: async ({ input }) => encounters.getEncounter(input),
    list_encounters: async ({ input }) => encounters.listEncounters(input),
    set_encounter_status: async ({ input }) => encounters.setEncounterStatus(input),
    archive_encounter: async ({ input }) => encounters.archiveEncounter(input),
    add_event: async ({ input }) => encounters.addEncounterEvent(input),
    list_events: async ({ input }) => encounters.listEvents(input),
    import_encounters: async ({ input }) => encounters.importEncounters(input),
    export_encounters: async ({ input }) => encounters.exportEncounters(input)
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

function luckSchema() {
  return {
    type: 'object',
    properties: {
      luck: { type: 'object', additionalProperties: true },
      luckCheck: { type: 'object', additionalProperties: true },
      diceResult: { type: 'object', additionalProperties: true },
      rollResult: { type: 'object', additionalProperties: true },
      tier: { type: 'string' },
      luckTier: { type: 'string' },
      score: { type: 'number' },
      luckScore: { type: 'number' },
      percent: { type: 'number' },
      total: { type: 'number' },
      value: { type: 'number' },
      luckTotal: { type: 'number' },
      dc: { type: 'number' },
      difficultyClass: { type: 'number' },
      threshold: { type: 'number' },
      successThreshold: { type: 'number' },
      roll: { type: 'number' },
      luckRoll: { type: 'number' },
      outcome: { type: 'string' },
      result: { type: 'string' },
      reason: { type: 'string' }
    },
    additionalProperties: true
  };
}

function createEncounterSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string' },
      triggerResult: { type: 'object', additionalProperties: true },
      trigger: { type: 'object', additionalProperties: true },
      sourceTriggerEventId: { type: 'string' },
      triggerEventId: { type: 'string' },
      luck: { type: 'object', additionalProperties: true },
      luckCheck: { type: 'object', additionalProperties: true },
      diceResult: { type: 'object', additionalProperties: true },
      rollResult: { type: 'object', additionalProperties: true },
      luckTier: { type: 'string' },
      luckScore: { type: 'number' },
      sceneContext: { type: 'string' },
      context: { type: 'string' },
      mapContext: { type: 'string' },
      npcContext: { type: 'string' },
      partyContext: { type: 'string' },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      referenceTemplate: { type: 'string' },
      template: { type: 'string' },
      userRules: { type: 'string' },
      rules: { type: 'string' },
      encounter: { type: 'object', additionalProperties: true },
      record: { type: 'object', additionalProperties: true },
      encounterRecord: { type: 'object', additionalProperties: true },
      title: { type: 'string' },
      immediateSituation: { type: 'string' },
      objective: { type: 'string' },
      resolutionCriteria: arraySchema(),
      stateFacts: arraySchema(),
      openQuestions: arraySchema(),
      difficultyHint: { type: 'string' },
      riskHint: { type: 'string' },
      rewardHints: arraySchema(),
      failureImpact: { type: 'object', additionalProperties: true },
      resolutionBudget: { type: 'integer', minimum: 0 },
      dryRun: { type: 'boolean', default: false },
      useLlm: { type: 'boolean', default: false },
      temperature: { type: 'number' },
      maxTokens: { type: 'integer', minimum: 1, maximum: 12000 }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function tickSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      encounterId: { type: 'string' },
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

function outcomeSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      encounterId: { type: 'string' },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      sceneContext: { type: 'string' },
      context: { type: 'string' },
      userRules: { type: 'string' },
      rules: { type: 'string' },
      eventLimit: { type: 'integer', minimum: 1, maximum: 200 },
      decision: { type: 'object', additionalProperties: true },
      outcome: { type: 'object', additionalProperties: true },
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
      encounterId: { type: 'string' },
      outcome: { type: 'object', additionalProperties: true },
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
      encounterId: { type: 'string' },
      failure: { type: 'object', additionalProperties: true },
      failureOrOutcome: { type: 'object', additionalProperties: true },
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

function applyRewardSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      encounterId: { type: 'string' },
      sceneId: { type: 'string' },
      rewardActorId: { type: 'string' },
      recipientActorId: { type: 'string' },
      actorId: { type: 'string' },
      playerId: { type: 'string' },
      recipientActorIds: {
        anyOf: [
          { type: 'array', items: { type: 'string' } },
          { type: 'string' }
        ]
      },
      rewardPlan: { type: 'object', additionalProperties: true },
      plan: { type: 'object', additionalProperties: true },
      rewards: { type: 'array', items: {}, default: [] },
      loot: { type: 'array', items: {}, default: [] },
      currency: { type: 'object', additionalProperties: true },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      summary: { type: 'string' },
      dryRun: { type: 'boolean', default: false },
      applyRewards: { type: 'boolean', default: true },
      applyImpactToolCalls: { type: 'boolean', default: true },
      applyInfluence: { type: 'boolean', default: true },
      continueOnImpactError: { type: 'boolean', default: false },
      recordEvent: { type: 'boolean', default: true },
      applyEventToEncounter: { type: 'boolean', default: true },
      authorization: { type: 'object', additionalProperties: true },
      userAuthorization: { type: 'object', additionalProperties: true },
      approval: { type: 'object', additionalProperties: true },
      authorizationActor: { type: 'string' },
      actor: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function applyConsequenceSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      encounterId: { type: 'string' },
      sceneId: { type: 'string' },
      consequencePlan: { type: 'object', additionalProperties: true },
      plan: { type: 'object', additionalProperties: true },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      summary: { type: 'string' },
      dryRun: { type: 'boolean', default: false },
      applyImpactToolCalls: { type: 'boolean', default: true },
      applyInfluence: { type: 'boolean', default: true },
      continueOnImpactError: { type: 'boolean', default: false },
      recordEvent: { type: 'boolean', default: true },
      applyEventToEncounter: { type: 'boolean', default: true },
      authorization: { type: 'object', additionalProperties: true },
      userAuthorization: { type: 'object', additionalProperties: true },
      approval: { type: 'object', additionalProperties: true },
      authorizationActor: { type: 'string' },
      actor: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function encounterRecordSchema({ required = [] } = {}) {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      encounterId: { type: 'string' },
      title: { type: 'string' },
      status: { type: 'string' },
      sceneId: { type: 'string' },
      encounterType: { type: 'string' },
      type: { type: 'string' },
      luckTier: { type: 'string' },
      luckScore: { type: 'number' },
      luckDetail: { type: 'object', additionalProperties: true },
      sourceTriggerEventId: { type: 'string' },
      triggerEventId: { type: 'string' },
      entryText: { type: 'string' },
      hookText: { type: 'string' },
      arrivalText: { type: 'string' },
      immediateSituation: { type: 'string' },
      situation: { type: 'string' },
      objective: { type: 'string' },
      resolutionCriteria: arraySchema(),
      successCriteria: arraySchema(),
      stateFacts: arraySchema(),
      knownFacts: arraySchema(),
      openQuestions: arraySchema(),
      involvedNpcIds: stringArraySchema(),
      npcIds: stringArraySchema(),
      involvedFactionIds: stringArraySchema(),
      factionIds: stringArraySchema(),
      locations: arraySchema(),
      difficultyHint: { type: 'string' },
      riskHint: { type: 'string' },
      rewardHints: arraySchema(),
      rewards: arraySchema(),
      failureImpact: { type: 'object', additionalProperties: true },
      noFreePunishmentRule: { type: 'boolean' },
      resolutionPressure: { type: 'string' },
      resolutionBudget: { type: 'integer', minimum: 0 },
      budgetRemaining: { type: 'integer', minimum: 0 },
      metadata: { type: 'object', additionalProperties: true },
      createdAtIso: { type: 'string' },
      encounterUpdatedAt: { type: 'string' }
    },
    required,
    additionalProperties: false
  };
}

function encounterIdentitySchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      encounterId: { type: 'string' },
      missing: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function listEncountersSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      status: {
        anyOf: [
          { type: 'string' },
          stringArraySchema()
        ]
      },
      activeOnly: { type: 'boolean', default: false },
      sceneId: { type: 'string' },
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
      encounterId: { type: 'string' },
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

function encounterEventSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      encounterId: { type: 'string' },
      encounterRecordId: { type: 'string' },
      eventId: { type: 'string' },
      id: { type: 'string' },
      eventType: { type: 'string' },
      type: { type: 'string' },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      summary: { type: 'string' },
      description: { type: 'string' },
      sceneId: { type: 'string' },
      linkedActionId: { type: 'string' },
      linkedNpcIds: stringArraySchema(),
      npcIds: stringArraySchema(),
      linkedFactionIds: stringArraySchema(),
      factionIds: stringArraySchema(),
      stateUpdates: arraySchema(),
      updates: arraySchema(),
      pressureDelta: { type: 'integer' },
      budgetSpent: { type: 'integer', minimum: 0 },
      tickType: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true },
      applyToEncounter: { type: 'boolean', default: true },
      autoResolve: { type: 'boolean', default: true },
      createdAtIso: { type: 'string' }
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
      encounterId: { type: 'string' },
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

function importSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      format: { type: 'string' },
      text: { type: 'string' },
      data: { type: 'object', additionalProperties: true },
      collection: { type: 'string' },
      collectionMap: { type: 'object', additionalProperties: true },
      idField: { type: 'string' }
    },
    required: ['chatSessionId'],
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
      status: {
        anyOf: [
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
