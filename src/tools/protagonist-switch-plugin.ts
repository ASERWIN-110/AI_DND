// @ts-nocheck
import { ProtagonistSwitchManager } from '../actors/protagonist-switch-manager.js';

export const PROTAGONIST_SWITCH_PLUGIN = {
  id: 'system.protagonist',
  name: 'Protagonist Switch Tools',
  version: '0.1.0',
  description: 'Chat-local protagonist pointer and switch history. Perspective switch changes view only; possession switch copies prior runtime changes to the new actor.',
  enabled: true,
  permissions: ['protagonist:read', 'protagonist:write'],
  tools: [
    {
      name: 'describe_manager',
      title: 'Describe Protagonist Switch Manager',
      description: 'Describe active protagonist, switch history, and actor runtime state collections.',
      inputSchema: chatSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['protagonist', 'schema', 'help']
    },
    {
      name: 'get_active',
      title: 'Get Active Protagonist',
      description: 'Read the current active protagonist pointer and its actor runtime state, if present.',
      inputSchema: chatSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['protagonist', 'query']
    },
    {
      name: 'switch_perspective',
      title: 'Switch Perspective',
      description: 'Switch to a new protagonist viewpoint without inheriting the previous protagonist runtime state.',
      inputSchema: switchSchema({ possession: false }),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        switchMode: 'perspective'
      },
      tags: ['protagonist', 'perspective', 'view', 'write']
    },
    {
      name: 'switch_possession',
      title: 'Switch Possession',
      description: 'Switch protagonist by possession: copy selected runtime state fields from the previous actor to the new actor, then activate the new actor.',
      inputSchema: switchSchema({ possession: true }),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        switchMode: 'possession'
      },
      tags: ['protagonist', 'possession', 'inherit', 'write']
    },
    {
      name: 'list_switches',
      title: 'List Protagonist Switches',
      description: 'List protagonist switch history records in one chat.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          mode: { type: 'string', enum: ['perspective', 'possession'] },
          fromActorId: { type: 'string' },
          toActorId: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          offset: { type: 'integer', minimum: 0 }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['protagonist', 'history', 'query']
    },
    {
      name: 'build_prompt_context',
      title: 'Build Active Protagonist Prompt Context',
      description: 'Build a compact prompt section for the currently active protagonist pointer and actor runtime state.',
      inputSchema: chatSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['protagonist', 'prompt', 'context']
    }
  ]
};

export function createProtagonistSwitchHandlers({ appDatabase, manager, actorState, trace } = {}) {
  const protagonist = manager || new ProtagonistSwitchManager({
    appDatabase,
    actorState,
    trace
  });
  return {
    describe_manager: async ({ input }) => protagonist.describe(input.chatSessionId),
    get_active: async ({ input }) => protagonist.getActive(input),
    switch_perspective: async ({ input }) => protagonist.switchPerspective(input),
    switch_possession: async ({ input }) => protagonist.switchPossession(input),
    list_switches: async ({ input }) => protagonist.listSwitches(input),
    build_prompt_context: async ({ input }) => protagonist.buildPromptContext(input)
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

function switchSchema({ possession } = {}) {
  const properties = {
    chatSessionId: { type: 'string' },
    sceneId: { type: 'string', default: 'current' },
    fromSceneId: { type: 'string' },
    toSceneId: { type: 'string' },
    fromActorId: { type: 'string' },
    sourceActorId: { type: 'string' },
    fromNpcId: { type: 'string' },
    sourceNpcId: { type: 'string' },
    toActorId: { type: 'string' },
    targetActorId: { type: 'string' },
    toNpcId: { type: 'string' },
    targetNpcId: { type: 'string' },
    npcId: { type: 'string' },
    playerId: { type: 'string' },
    toPlayerId: { type: 'string' },
    targetPlayerId: { type: 'string' },
    toName: { type: 'string' },
    targetName: { type: 'string' },
    name: { type: 'string' },
    greeting: { type: 'string' },
    initialGreeting: { type: 'string' },
    initialSituation: { type: 'string' },
    openingSituation: { type: 'string' },
    reason: { type: 'string' },
    metadata: { type: 'object', additionalProperties: true }
  };
  if (possession) {
    properties.inheritFields = stringArraySchema();
    properties.allowMissingSource = { type: 'boolean', default: false };
  } else {
    properties.createTargetState = { type: 'boolean', default: false };
  }
  return {
    type: 'object',
    properties,
    required: ['chatSessionId'],
    additionalProperties: false
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
