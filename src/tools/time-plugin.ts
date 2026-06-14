// @ts-nocheck
import { TimeTurnManager } from '../time/time-turn-manager.js';

export const TIME_PLUGIN = {
  id: 'system.time',
  name: 'Time And Turn Tools',
  version: '0.1.0',
  description: 'Chat-local time, encounter, initiative, turn order, duration effect, and scheduled event tools.',
  enabled: true,
  permissions: ['time:read', 'time:write'],
  tools: [
    {
      name: 'get_interpreter_settings',
      title: 'Get Time Interpreter Settings',
      description: 'Get the chat-local rule/LLM time interpretation settings. LLM estimation is off by default.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          source: { type: 'string' }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['time', 'interpreter', 'settings']
    },
    {
      name: 'set_interpreter_settings',
      title: 'Set Time Interpreter Settings',
      description: 'Enable/disable rule-based and optional LLM time interpretation. Requires explicit user authorization.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          enabled: { type: 'boolean' },
          llmEnabled: { type: 'boolean' },
          timeEstimationEnabled: { type: 'boolean' },
          autoApply: { type: 'boolean' },
          confidenceThreshold: { type: 'number', minimum: 0, maximum: 1 },
          confirmationThreshold: { type: 'number', minimum: 0, maximum: 1 },
          rules: rulePackSchema(),
          source: { type: 'string' }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      annotations: { requiresUserAuthorization: true },
      metadata: {
        scope: 'chat-session',
        requiresUserAuthorization: true
      },
      tags: ['time', 'interpreter', 'settings', 'write']
    },
    {
      name: 'build_advance_prompt',
      title: 'Build Time Advance Prompt',
      description: 'Build the LLM prompt used to judge whether free-form text should advance time or turns.',
      inputSchema: advanceInterpretInputSchema({
        includePromptOnly: { type: 'boolean', default: true }
      }),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['time', 'interpreter', 'prompt']
    },
    {
      name: 'interpret_advance',
      title: 'Interpret Time Advance',
      description: 'Rule-first optional-LLM interpreter that proposes whether text should advance time, end a turn, advance rounds, or schedule an event. It returns proposals only and does not execute them.',
      inputSchema: advanceInterpretInputSchema({
        useLlm: { type: 'boolean' },
        preferLlm: { type: 'boolean', default: false },
        force: { type: 'boolean', default: false },
        maxTokens: { type: 'integer', minimum: 1, maximum: 4000 }
      }),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['time', 'interpreter', 'llm', 'rules']
    },
    {
      name: 'get_clock',
      title: 'Get Time Clock',
      description: 'Get or initialize the chat-local world/scene/round clock.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          sceneId: { type: 'string', default: 'current' },
          source: { type: 'string' }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['time', 'clock', 'query']
    },
    {
      name: 'advance_time',
      title: 'Advance Time',
      description: 'Advance narrative or scene time by seconds, minutes, hours, days, or amount/unit. Returns due world clocks but does not run them automatically.',
      inputSchema: durationInputSchema({
        phase: { type: 'string' },
        mode: { type: 'string' },
        sceneId: { type: 'string', default: 'current' },
        source: { type: 'string' }
      }),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: { scope: 'chat-session' },
      tags: ['time', 'clock', 'write']
    },
    {
      name: 'get_world_clock',
      title: 'Get World Clock',
      description: 'Get or initialize a chat-local periodic world clock used to propose NPC, faction, disaster, and environment pulses.',
      inputSchema: worldClockIdentitySchema({
        sceneId: { type: 'string', default: 'current' },
        source: { type: 'string' }
      }),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['time', 'world-clock', 'query']
    },
    {
      name: 'list_world_clocks',
      title: 'List World Clocks',
      description: 'List chat-local world pulse clocks.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          sceneId: { type: 'string' },
          status: { type: 'string' },
          enabled: { type: 'boolean' },
          filter: { type: 'object', additionalProperties: true },
          sort: sortSchema(),
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          offset: { type: 'integer', minimum: 0 }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['time', 'world-clock', 'query']
    },
    {
      name: 'set_world_clock',
      title: 'Set World Clock',
      description: 'Create or update a world pulse clock. Requires explicit user authorization because it changes autonomous-world behavior.',
      inputSchema: worldClockInputSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      annotations: { requiresUserAuthorization: true },
      metadata: {
        scope: 'chat-session',
        requiresUserAuthorization: true
      },
      tags: ['time', 'world-clock', 'settings', 'write']
    },
    {
      name: 'build_world_pulse_prompt',
      title: 'Build World Pulse Prompt',
      description: 'Build the editable LLM prompt used to propose periodic NPC/faction/environment world-pulse events.',
      inputSchema: worldPulseInputSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['time', 'world-clock', 'prompt']
    },
    {
      name: 'generate_world_pulse',
      title: 'Generate World Pulse',
      description: 'Generate inspectable world-pulse event proposals and tool-call suggestions without scheduling them.',
      inputSchema: worldPulseInputSchema({
        useLlm: { type: 'boolean' },
        temperature: { type: 'number' },
        maxTokens: { type: 'integer', minimum: 1, maximum: 4000 }
      }),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['time', 'world-clock', 'event', 'proposal']
    },
    {
      name: 'run_world_pulse',
      title: 'Run World Pulse',
      description: 'Run a due world pulse. Defaults to dryRun=true; with dryRun=false it writes generated due events into time_events and advances the world clock.',
      inputSchema: worldPulseInputSchema({
        dryRun: { type: 'boolean', default: true },
        useLlm: { type: 'boolean' },
        temperature: { type: 'number' },
        maxTokens: { type: 'integer', minimum: 1, maximum: 4000 }
      }),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session' },
      tags: ['time', 'world-clock', 'event', 'write']
    },
    {
      name: 'start_encounter',
      title: 'Start Encounter',
      description: 'Start a combat/exploration/chase/social encounter and create an initiative turn order.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          encounterId: { type: 'string' },
          id: { type: 'string' },
          sceneId: { type: 'string', default: 'current' },
          name: { type: 'string' },
          mode: { type: 'string', default: 'combat' },
          status: { type: 'string', default: 'active' },
          roundNumber: { type: 'integer', minimum: 0 },
          roundDurationSeconds: { type: 'integer', minimum: 1 },
          participants: {
            type: 'array',
            items: participantSchema()
          },
          metadata: { type: 'object', additionalProperties: true },
          source: { type: 'string' }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: { scope: 'chat-session' },
      tags: ['time', 'encounter', 'initiative', 'write']
    },
    {
      name: 'end_encounter',
      title: 'End Encounter',
      description: 'End or archive the active encounter and return the clock to narrative time.',
      inputSchema: encounterIdentitySchema({
        status: { type: 'string', default: 'ended' },
        phase: { type: 'string', default: 'narrative' },
        source: { type: 'string' }
      }),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: { scope: 'chat-session' },
      tags: ['time', 'encounter', 'write']
    },
    {
      name: 'get_encounter',
      title: 'Get Encounter',
      description: 'Get the active encounter or a specific encounter by id.',
      inputSchema: encounterIdentitySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['time', 'encounter', 'query']
    },
    {
      name: 'list_encounters',
      title: 'List Encounters',
      description: 'List chat-local encounters.',
      inputSchema: {
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
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['time', 'encounter', 'query']
    },
    {
      name: 'list_turn_order',
      title: 'List Turn Order',
      description: 'List the initiative order for the active or selected encounter.',
      inputSchema: encounterIdentitySchema({
        includeInactive: { type: 'boolean', default: false },
        status: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
        offset: { type: 'integer', minimum: 0 }
      }),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['time', 'turn', 'initiative', 'query']
    },
    {
      name: 'add_participant',
      title: 'Add Encounter Participant',
      description: 'Add or replace one participant in the current encounter turn order.',
      inputSchema: {
        ...participantSchema(),
        required: ['chatSessionId']
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: { scope: 'chat-session' },
      tags: ['time', 'turn', 'participant', 'write']
    },
    {
      name: 'remove_participant',
      title: 'Remove Encounter Participant',
      description: 'Remove a participant from the turn order, or mark them removed/defeated.',
      inputSchema: participantIdentitySchema({
        mode: { type: 'string', enum: ['markRemoved', 'delete', 'defeat'], default: 'markRemoved' }
      }),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        destructive: true
      },
      tags: ['time', 'turn', 'participant', 'delete']
    },
    {
      name: 'set_initiative',
      title: 'Set Initiative',
      description: 'Set one participant initiative score and reorder the encounter.',
      inputSchema: participantIdentitySchema({
        initiative: { type: 'number' },
        initiativeRoll: { type: 'object', additionalProperties: true },
        dexterityModifier: { type: 'integer' }
      }, ['initiative']),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: { scope: 'chat-session' },
      tags: ['time', 'turn', 'initiative', 'write']
    },
    {
      name: 'roll_initiative',
      title: 'Roll Initiative',
      description: 'Roll D&D-style d20 initiative with crypto-backed dice randomness and reorder participants.',
      inputSchema: encounterIdentitySchema({
        participantId: { type: 'string' },
        actorId: { type: 'string' },
        npcId: { type: 'string' },
        participantIds: stringArraySchema(),
        dexterityModifier: { type: 'integer' },
        modifier: { type: 'integer', default: 0 },
        modifiers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              value: { type: 'integer' }
            },
            required: ['name', 'value'],
            additionalProperties: false
          }
        },
        rollMode: { type: 'string', enum: ['normal', 'advantage', 'disadvantage'], default: 'normal' },
        includeInactive: { type: 'boolean', default: false }
      }),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: { scope: 'chat-session' },
      tags: ['time', 'turn', 'initiative', 'dice']
    },
    {
      name: 'next_turn',
      title: 'Next Turn',
      description: 'End the current participant turn and advance to the next active participant, ticking round/turn effects.',
      inputSchema: encounterIdentitySchema({
        source: { type: 'string' }
      }),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: { scope: 'chat-session' },
      tags: ['time', 'turn', 'write']
    },
    {
      name: 'end_turn',
      title: 'End Turn',
      description: 'Alias for next_turn.',
      inputSchema: encounterIdentitySchema({
        source: { type: 'string' }
      }),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: { scope: 'chat-session' },
      tags: ['time', 'turn', 'write']
    },
    {
      name: 'add_effect',
      title: 'Add Time Effect',
      description: 'Add a duration effect, condition, cooldown, concentration marker, or timed modifier.',
      inputSchema: effectInputSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: { scope: 'chat-session' },
      tags: ['time', 'effect', 'write']
    },
    {
      name: 'patch_effect',
      title: 'Patch Time Effect',
      description: 'Patch one duration effect.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          effectId: { type: 'string' },
          id: { type: 'string' },
          patch: effectPatchSchema()
        },
        required: ['chatSessionId', 'patch'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: { scope: 'chat-session' },
      tags: ['time', 'effect', 'write']
    },
    {
      name: 'remove_effect',
      title: 'Remove Time Effect',
      description: 'Mark an effect removed/expired, or delete it.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          effectId: { type: 'string' },
          id: { type: 'string' },
          mode: { type: 'string', enum: ['markRemoved', 'delete'], default: 'markRemoved' },
          status: { type: 'string', default: 'removed' }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        destructive: true
      },
      tags: ['time', 'effect', 'delete']
    },
    {
      name: 'list_effects',
      title: 'List Time Effects',
      description: 'List active or historical duration effects.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          encounterId: { type: 'string' },
          sceneId: { type: 'string' },
          targetParticipantId: { type: 'string' },
          ownerParticipantId: { type: 'string' },
          status: { type: 'string' },
          includeInactive: { type: 'boolean', default: false },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          offset: { type: 'integer', minimum: 0 }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['time', 'effect', 'query']
    },
    {
      name: 'schedule_event',
      title: 'Schedule Time Event',
      description: 'Schedule an event by elapsed time or future round.',
      inputSchema: scheduleEventSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: { scope: 'chat-session' },
      tags: ['time', 'event', 'write']
    },
    {
      name: 'resolve_due_events',
      title: 'Resolve Due Time Events',
      description: 'Find due scheduled events and mark them due or resolved.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          includeDue: { type: 'boolean', default: false },
          markResolved: { type: 'boolean', default: false },
          status: { type: 'string', enum: ['due', 'resolved'], default: 'due' }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: { scope: 'chat-session' },
      tags: ['time', 'event', 'write']
    },
    {
      name: 'list_events',
      title: 'List Time Events',
      description: 'List scheduled, due, resolved, or cancelled time events.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          encounterId: { type: 'string' },
          sceneId: { type: 'string' },
          status: { type: 'string' },
          includeResolved: { type: 'boolean', default: false },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          offset: { type: 'integer', minimum: 0 }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['time', 'event', 'query']
    },
    {
      name: 'export_timeline',
      title: 'Export Time Timeline',
      description: 'Export the chat-local time clock, encounters, turn order, effects, and events as JSON or YAML.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          format: { type: 'string', enum: ['json', 'yaml', 'yml'], default: 'json' },
          includeResolved: { type: 'boolean', default: true }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['time', 'export', 'json', 'yaml']
    },
    {
      name: 'import_timeline',
      title: 'Import Time Timeline',
      description: 'Import a time timeline from JSON, YAML, or XML into one chat-local database.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          text: { type: 'string', minLength: 1 },
          format: { type: 'string', enum: ['auto', 'json', 'yaml', 'yml', 'xml'], default: 'auto' },
          collection: { type: 'string' },
          collectionMap: { type: 'object', additionalProperties: { type: 'string' } },
          idField: { type: 'string', default: 'id' },
          source: { type: 'string', default: 'document-import' }
        },
        required: ['chatSessionId', 'text'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: { scope: 'chat-session' },
      tags: ['time', 'import', 'json', 'yaml', 'xml']
    },
    {
      name: 'describe_time_db',
      title: 'Describe Time DB',
      description: 'Describe chat-local time collections and synchronized schema files.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['time', 'schema']
    }
  ]
};

export function createTimeHandlers({ appDatabase, manager, trace, chatProvider } = {}) {
  const time = manager || new TimeTurnManager({ appDatabase, trace, chatProvider });
  return {
    get_interpreter_settings: async ({ input }) => time.getInterpreterSettings(input),
    set_interpreter_settings: async ({ input }) => time.setInterpreterSettings(input),
    build_advance_prompt: async ({ input }) => ({
      prompt: time.buildAdvanceDecisionPrompt(input)
    }),
    interpret_advance: async ({ input }) => time.interpretAdvance(input),
    get_clock: async ({ input }) => time.getClock(input),
    advance_time: async ({ input }) => time.advanceTime(input),
    get_world_clock: async ({ input }) => time.getWorldClock(input),
    list_world_clocks: async ({ input }) => time.listWorldClocks(input),
    set_world_clock: async ({ input }) => time.setWorldClock(input),
    build_world_pulse_prompt: async ({ input }) => ({
      prompt: time.buildWorldPulsePrompt(input)
    }),
    generate_world_pulse: async ({ input }) => time.generateWorldPulse(input),
    run_world_pulse: async ({ input }) => time.runWorldPulse(input),
    start_encounter: async ({ input }) => time.startEncounter(input),
    end_encounter: async ({ input }) => time.endEncounter(input),
    get_encounter: async ({ input }) => time.getEncounter(input),
    list_encounters: async ({ input }) => time.listEncounters(input),
    list_turn_order: async ({ input }) => time.listTurnOrder(input),
    add_participant: async ({ input }) => time.addParticipant(input),
    remove_participant: async ({ input }) => time.removeParticipant(input),
    set_initiative: async ({ input }) => time.setInitiative(input),
    roll_initiative: async ({ input }) => time.rollInitiative(input),
    next_turn: async ({ input }) => time.nextTurn(input),
    end_turn: async ({ input }) => time.endTurn(input),
    add_effect: async ({ input }) => time.addEffect(input),
    patch_effect: async ({ input }) => time.patchEffect(input),
    remove_effect: async ({ input }) => time.removeEffect(input),
    list_effects: async ({ input }) => time.listEffects(input),
    schedule_event: async ({ input }) => time.scheduleEvent(input),
    resolve_due_events: async ({ input }) => time.resolveDueEvents(input),
    list_events: async ({ input }) => time.listEvents(input),
    export_timeline: async ({ input }) => time.exportTimeline(input),
    import_timeline: async ({ input }) => time.importTimeline(input),
    describe_time_db: async ({ input }) => time.describe(input.chatSessionId)
  };
}

function advanceInterpretInputSchema(extraProperties = {}) {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      encounterId: { type: 'string' },
      sceneId: { type: 'string' },
      recentContext: { type: 'string' },
      context: { type: 'string' },
      ...extraProperties
    },
    required: ['chatSessionId'],
    anyOf: [
      { required: ['text'] },
      { required: ['content'] }
    ],
    additionalProperties: false
  };
}

function durationInputSchema(extraProperties = {}) {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      seconds: { type: 'integer' },
      minutes: { type: 'integer' },
      hours: { type: 'integer' },
      days: { type: 'integer' },
      amount: { type: 'integer' },
      unit: { type: 'string', enum: ['second', 'seconds', 'sec', 's', 'minute', 'minutes', 'min', 'm', 'hour', 'hours', 'h', 'day', 'days', 'd', 'round', 'rounds'] },
      ...extraProperties
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function worldClockIdentitySchema(extraProperties = {}, extraRequired = []) {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      worldClockId: { type: 'string' },
      id: { type: 'string' },
      ...extraProperties
    },
    required: ['chatSessionId', ...extraRequired],
    additionalProperties: false
  };
}

function worldClockInputSchema() {
  return worldClockIdentitySchema({
    sceneId: { type: 'string', default: 'current' },
    name: { type: 'string' },
    enabled: { type: 'boolean' },
    status: { type: 'string' },
    llmEnabled: { type: 'boolean' },
    autoSchedule: { type: 'boolean' },
    intervalSeconds: { type: 'integer', minimum: 1 },
    pulseIntervalSeconds: { type: 'integer', minimum: 1 },
    nextPulseElapsedSeconds: { type: 'integer', minimum: 0 },
    lastPulseElapsedSeconds: { type: 'integer', minimum: 0 },
    pulseCount: { type: 'integer', minimum: 0 },
    randomEventChance: { type: 'number', minimum: 0, maximum: 1 },
    npcActionChance: { type: 'number', minimum: 0, maximum: 1 },
    factionActionChance: { type: 'number', minimum: 0, maximum: 1 },
    disasterChance: { type: 'number', minimum: 0, maximum: 1 },
    environmentEventChance: { type: 'number', minimum: 0, maximum: 1 },
    maxEventsPerPulse: { type: 'integer', minimum: 1 },
    eventTables: worldEventTablesSchema(),
    rules: { type: 'object', additionalProperties: true },
    metadata: { type: 'object', additionalProperties: true },
    source: { type: 'string' }
  });
}

function worldPulseInputSchema(extraProperties = {}) {
  return worldClockIdentitySchema({
    sceneId: { type: 'string', default: 'current' },
    force: { type: 'boolean', default: false },
    outputMode: { type: 'string' },
    context: contextValueSchema(),
    contextText: { type: 'string' },
    recentContext: { type: 'string' },
    userRules: { type: 'string' },
    rulesText: { type: 'string' },
    npcRefs: referenceArraySchema(),
    npcs: referenceArraySchema(),
    actorRefs: referenceArraySchema(),
    actorIds: stringArraySchema(),
    npcIds: stringArraySchema(),
    factionRefs: referenceArraySchema(),
    factions: referenceArraySchema(),
    factionIds: stringArraySchema(),
    randomEventChance: { type: 'number', minimum: 0, maximum: 1 },
    npcActionChance: { type: 'number', minimum: 0, maximum: 1 },
    factionActionChance: { type: 'number', minimum: 0, maximum: 1 },
    disasterChance: { type: 'number', minimum: 0, maximum: 1 },
    environmentEventChance: { type: 'number', minimum: 0, maximum: 1 },
    maxEventsPerPulse: { type: 'integer', minimum: 1 },
    eventTables: worldEventTablesSchema(),
    source: { type: 'string' },
    ...extraProperties
  });
}

function worldEventTablesSchema() {
  return {
    type: 'object',
    properties: {
      npcActions: { type: 'array', items: worldEventEntrySchema() },
      factionActions: { type: 'array', items: worldEventEntrySchema() },
      disasters: { type: 'array', items: worldEventEntrySchema() },
      environmentEvents: { type: 'array', items: worldEventEntrySchema() },
      randomEvents: { type: 'array', items: worldEventEntrySchema() }
    },
    additionalProperties: true
  };
}

function worldEventEntrySchema() {
  return {
    anyOf: [
      { type: 'string' },
      {
        type: 'object',
        properties: {
          id: { type: 'string' },
          eventId: { type: 'string' },
          title: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          summary: { type: 'string' },
          severity: { type: 'string' },
          weight: { type: 'number', exclusiveMinimum: 0 },
          templateId: { type: 'string' },
          proposedToolCalls: { type: 'array', items: { type: 'object', additionalProperties: true } },
          metadata: { type: 'object', additionalProperties: true }
        },
        additionalProperties: true
      }
    ]
  };
}

function referenceArraySchema() {
  return {
    anyOf: [
      {
        type: 'array',
        items: {
          anyOf: [
            { type: 'string' },
            { type: 'object', additionalProperties: true }
          ]
        }
      },
      { type: 'string' }
    ]
  };
}

function contextValueSchema() {
  return {
    anyOf: [
      { type: 'object', additionalProperties: true },
      { type: 'string' }
    ]
  };
}

function rulePackSchema() {
  return {
    type: 'object',
    properties: {
      noAdvance: { type: 'array', items: ruleSchema() },
      explicitTurnEnd: { type: 'array', items: ruleSchema() },
      completedTurn: { type: 'array', items: ruleSchema() },
      maybeTurnProgress: { type: 'array', items: ruleSchema() },
      timeAdvance: { type: 'array', items: ruleSchema({ duration: true }) }
    },
    additionalProperties: true
  };
}

function ruleSchema({ duration = false } = {}) {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      keywords: stringArraySchema(),
      allKeywords: stringArraySchema(),
      regex: { type: 'string' },
      ...(duration ? {
        seconds: { type: 'integer', minimum: 0 },
        minutes: { type: 'integer', minimum: 0 },
        hours: { type: 'integer', minimum: 0 },
        days: { type: 'integer', minimum: 0 }
      } : {})
    },
    required: ['id'],
    additionalProperties: true
  };
}

function encounterIdentitySchema(extraProperties = {}, extraRequired = []) {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      encounterId: { type: 'string' },
      id: { type: 'string' },
      ...extraProperties
    },
    required: ['chatSessionId', ...extraRequired],
    additionalProperties: false
  };
}

function participantIdentitySchema(extraProperties = {}, extraRequired = []) {
  return encounterIdentitySchema({
    participantId: { type: 'string' },
    actorId: { type: 'string' },
    npcId: { type: 'string' },
    ...extraProperties
  }, extraRequired);
}

function participantSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      encounterId: { type: 'string' },
      id: { type: 'string' },
      participantId: { type: 'string' },
      actorId: { type: 'string' },
      npcId: { type: 'string' },
      sceneId: { type: 'string' },
      name: { type: 'string' },
      actorType: { type: 'string' },
      type: { type: 'string' },
      initiative: { type: 'number' },
      initiativeScore: { type: 'number' },
      initiativeRoll: { type: 'object', additionalProperties: true },
      dexterityModifier: { type: 'integer' },
      dexMod: { type: 'integer' },
      orderIndex: { type: 'integer', minimum: 0 },
      status: { type: 'string' },
      hasActed: { type: 'boolean' },
      actionState: { type: 'object', additionalProperties: true },
      tags: stringArraySchema(),
      metadata: { type: 'object', additionalProperties: true }
    },
    additionalProperties: false
  };
}

function effectInputSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      encounterId: { type: 'string' },
      sceneId: { type: 'string' },
      effectId: { type: 'string' },
      id: { type: 'string' },
      name: { type: 'string' },
      effectType: { type: 'string' },
      type: { type: 'string' },
      ownerParticipantId: { type: 'string' },
      ownerId: { type: 'string' },
      targetParticipantId: { type: 'string' },
      targetId: { type: 'string' },
      status: { type: 'string' },
      durationType: { type: 'string', enum: ['rounds', 'turns', 'seconds', 'scene', 'permanent'] },
      remainingRounds: { type: 'integer', minimum: 0 },
      durationRounds: { type: 'integer', minimum: 0 },
      rounds: { type: 'integer', minimum: 0 },
      remainingSeconds: { type: 'integer', minimum: 0 },
      durationSeconds: { type: 'integer', minimum: 0 },
      tickTiming: { type: 'string', enum: ['startTurn', 'endTurn', 'endRound', 'advanceTime', 'manual', 'round'] },
      values: numericObjectSchema(),
      metadata: { type: 'object', additionalProperties: true },
      source: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function effectPatchSchema() {
  const schema = effectInputSchema();
  delete schema.required;
  delete schema.properties.chatSessionId;
  return schema;
}

function scheduleEventSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      encounterId: { type: 'string' },
      sceneId: { type: 'string' },
      eventId: { type: 'string' },
      id: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      status: { type: 'string', default: 'scheduled' },
      triggerType: { type: 'string', enum: ['elapsedSeconds', 'round', 'turn', 'manual'] },
      dueElapsedSeconds: { type: 'integer', minimum: 0 },
      dueRound: { type: 'integer', minimum: 0 },
      dueTurnIndex: { type: 'integer', minimum: 0 },
      afterSeconds: { type: 'integer', minimum: 0 },
      afterMinutes: { type: 'integer', minimum: 0 },
      afterHours: { type: 'integer', minimum: 0 },
      afterDays: { type: 'integer', minimum: 0 },
      afterRounds: { type: 'integer', minimum: 0 },
      payload: { type: 'object', additionalProperties: true },
      metadata: { type: 'object', additionalProperties: true },
      source: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function numericObjectSchema() {
  return {
    type: 'object',
    additionalProperties: {
      anyOf: [
        { type: 'number' },
        { type: 'string' },
        { type: 'null' }
      ]
    }
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
        direction: { type: 'string', enum: ['asc', 'desc'], default: 'asc' }
      },
      required: ['field'],
      additionalProperties: false
    }
  };
}
