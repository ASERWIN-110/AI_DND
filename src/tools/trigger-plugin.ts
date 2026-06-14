// @ts-nocheck
import { TriggerManager } from '../triggers/trigger-manager.js';

export const TRIGGER_PLUGIN = {
  id: 'system.triggers',
  name: 'Deterministic Trigger Tools',
  version: '0.1.0',
  description: 'Non-LLM trigger tools for death, revival, status ticks, quest deadlines, time due events, scene end, party assignment deadlines, and random encounter checks.',
  enabled: true,
  permissions: ['triggers:read', 'triggers:write'],
  tools: [
    {
      name: 'describe_triggers',
      title: 'Describe Triggers',
      description: 'Describe deterministic trigger types, trigger event schema, and default encounter table. No LLM is used.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' }
        },
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['trigger', 'schema', 'no-llm']
    },
    {
      name: 'scan_death_triggers',
      title: 'Scan Death Triggers',
      description: 'Scan Actor state for hp<=0, death save failures, dead/dying/stable markers, and optionally enforce death/dying state.',
      inputSchema: deathScanSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['trigger', 'death', 'npc-state', 'no-llm']
    },
    {
      name: 'revive_actor',
      title: 'Revive Actor',
      description: 'Revive a dead/dying actor by restoring HP and clearing dead/dying/unconscious/stable death state. No LLM is used.',
      inputSchema: reviveSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['trigger', 'revive', 'npc-state', 'no-llm']
    },
    {
      name: 'tick_status_effects',
      title: 'Tick Status Effects',
      description: 'Apply deterministic periodic damage/healing and duration decrement for Actor specialStatuses. Supports turnActorId-gated effects such as shield until the next turn end.',
      inputSchema: statusTickSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['trigger', 'status', 'duration', 'periodic', 'no-llm']
    },
    {
      name: 'scan_quest_triggers',
      title: 'Scan Quest Triggers',
      description: 'Scan or apply deterministic quest deadline triggers using quest clocks.',
      inputSchema: questTriggerSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['trigger', 'quest', 'deadline', 'no-llm']
    },
    {
      name: 'scan_scene_end_triggers',
      title: 'Scan Scene-End Triggers',
      description: 'Run deterministic scene-end trigger checks such as scene-end quest expiry.',
      inputSchema: sceneEndSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['trigger', 'scene', 'quest', 'no-llm']
    },
    {
      name: 'scan_time_triggers',
      title: 'Scan Time Triggers',
      description: 'Scan due scheduled time events and due world clocks. Optionally resolve time events or run world pulses without LLM.',
      inputSchema: timeTriggerSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['trigger', 'time', 'world-clock', 'no-llm']
    },
    {
      name: 'scan_party_assignment_triggers',
      title: 'Scan Party Assignment Triggers',
      description: 'Scan party members assigned to offscreen tasks and mark due assignments when deterministic due conditions are reached.',
      inputSchema: partyAssignmentSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['trigger', 'party', 'assignment', 'no-llm']
    },
    {
      name: 'roll_encounter_trigger',
      title: 'Roll Encounter Trigger',
      description: 'Run a deterministic/random encounter chance check against a weighted table. Uses crypto random unless roll/pickRoll are supplied.',
      inputSchema: encounterTriggerSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session', writesTrace: true },
      tags: ['trigger', 'encounter', 'random', 'no-llm']
    },
    {
      name: 'list_trigger_events',
      title: 'List Trigger Events',
      description: 'List stored trigger events for audit and debugging.',
      inputSchema: listEventsSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['trigger', 'event', 'query']
    }
  ]
};

export function createTriggerHandlers({
  appDatabase,
  npcState,
  effectSettlement,
  questManager,
  timeManager,
  partyManager,
  manager,
  random,
  trace
} = {}) {
  const triggers = manager || new TriggerManager({
    appDatabase,
    npcState,
    effectSettlement,
    questManager,
    timeManager,
    partyManager,
    random,
    trace
  });
  return {
    describe_triggers: async ({ input }) => triggers.describe(input.chatSessionId),
    scan_death_triggers: async ({ input }) => triggers.scanDeathTriggers(input),
    revive_actor: async ({ input }) => triggers.reviveActor(input),
    tick_status_effects: async ({ input }) => triggers.tickStatusEffects(input),
    scan_quest_triggers: async ({ input }) => triggers.scanQuestTriggers(input),
    scan_scene_end_triggers: async ({ input }) => triggers.scanSceneEndTriggers(input),
    scan_time_triggers: async ({ input }) => triggers.scanTimeTriggers(input),
    scan_party_assignment_triggers: async ({ input }) => triggers.scanPartyAssignmentTriggers(input),
    roll_encounter_trigger: async ({ input }) => triggers.rollEncounterTrigger(input),
    list_trigger_events: async ({ input }) => triggers.listTriggerEvents(input)
  };
}

function deathScanSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string' },
      npcId: { type: 'string' },
      actorId: { type: 'string' },
      playerId: { type: 'string' },
      apply: { type: 'boolean', default: false },
      clearRecovered: { type: 'boolean', default: true },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      source: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function reviveSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      id: { type: 'string' },
      recordId: { type: 'string' },
      npcId: { type: 'string' },
      actorId: { type: 'string' },
      playerId: { type: 'string' },
      hp: { type: 'number' },
      reviveHp: { type: 'number' },
      amount: { type: 'number' },
      maxHp: { type: 'number' },
      allowOverheal: { type: 'boolean', default: false },
      addRevivedStatus: { type: 'boolean', default: true },
      source: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function statusTickSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string' },
      npcId: { type: 'string' },
      actorId: { type: 'string' },
      playerId: { type: 'string' },
      turnActorId: { type: 'string' },
      activeActorId: { type: 'string' },
      participantId: { type: 'string' },
      timing: { type: 'string', default: 'manual' },
      tickTiming: { type: 'string' },
      apply: { type: 'boolean', default: false },
      decrement: { type: 'boolean', default: true },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      source: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function questTriggerSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      elapsedSeconds: { type: 'integer', minimum: 0 },
      roundNumber: { type: 'integer', minimum: 0 },
      sceneEnded: { type: 'boolean', default: false },
      includePaused: { type: 'boolean', default: false },
      apply: { type: 'boolean', default: false },
      clock: { type: 'object', additionalProperties: true },
      encounter: { type: 'object', additionalProperties: true },
      summary: { type: 'string' },
      source: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function sceneEndSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string' },
      elapsedSeconds: { type: 'integer', minimum: 0 },
      roundNumber: { type: 'integer', minimum: 0 },
      includePaused: { type: 'boolean', default: false },
      apply: { type: 'boolean', default: false },
      source: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function timeTriggerSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string' },
      includePaused: { type: 'boolean', default: false },
      apply: { type: 'boolean', default: false },
      markResolved: { type: 'boolean', default: false },
      runWorldPulses: { type: 'boolean', default: false },
      forceWorldPulse: { type: 'boolean', default: false },
      source: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function partyAssignmentSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      partyId: { type: 'string', default: 'main' },
      activityStatus: { type: 'string', default: 'assigned' },
      elapsedSeconds: { type: 'integer', minimum: 0 },
      roundNumber: { type: 'integer', minimum: 0 },
      sceneEnded: { type: 'boolean', default: false },
      clock: { type: 'object', additionalProperties: true },
      encounter: { type: 'object', additionalProperties: true },
      assignmentStatus: { type: 'string', default: 'due' },
      force: { type: 'boolean', default: false },
      apply: { type: 'boolean', default: false },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      source: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function encounterTriggerSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      chance: { type: 'number', minimum: 0, maximum: 1 },
      encounterChance: { type: 'number', minimum: 0, maximum: 1 },
      roll: { type: 'number', minimum: 0, maximum: 1 },
      triggerRoll: { type: 'number', minimum: 0, maximum: 1 },
      pickRoll: { type: 'number', minimum: 0, maximum: 1 },
      tableRoll: { type: 'number', minimum: 0, maximum: 1 },
      force: { type: 'boolean', default: false },
      apply: { type: 'boolean', default: false },
      tableId: { type: 'string' },
      table: {
        type: 'array',
        items: encounterItemSchema()
      },
      encounterTable: {
        type: 'array',
        items: encounterItemSchema()
      },
      actorIds: stringArraySchema(),
      npcIds: stringArraySchema(),
      source: { type: 'string' }
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
      triggerType: { type: 'string' },
      status: { type: 'string' },
      sceneId: { type: 'string' },
      filter: { type: 'object', additionalProperties: true },
      sort: {
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
      },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function encounterItemSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      summary: { type: 'string' },
      weight: { type: 'number', exclusiveMinimum: 0 },
      category: { type: 'string' },
      challenge: { type: 'string' },
      difficulty: { type: 'string' },
      payload: { type: 'object', additionalProperties: true },
      metadata: { type: 'object', additionalProperties: true }
    },
    additionalProperties: true
  };
}

function stringArraySchema() {
  return {
    oneOf: [
      { type: 'string' },
      {
        type: 'array',
        items: { type: 'string' }
      }
    ]
  };
}
