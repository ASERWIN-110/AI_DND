// @ts-nocheck
import { ActorControlContextManager } from '../actors/actor-control-context.js';

export const ACTOR_CONTROL_PLUGIN = {
  id: 'system.actor_control',
  name: 'Actor Control Context Tools',
  version: '0.1.0',
  description: 'Chat-local player actor control context. It tags ordinary chat as a player actor claim and prevents asserted NPC/world outcomes from becoming facts without resolver/tool/user override.',
  enabled: true,
  permissions: ['actor-control:read', 'actor-control:write'],
  metadata: {
    llm: false,
    writesTrace: true
  },
  tools: [
    tool('describe_manager', 'Describe Actor Control Context Manager', 'Describe actor control collections, input authority rules, and canonical fact write channels.', chatSchema(), false, true, ['actor-control', 'schema', 'help', 'no-llm']),
    tool('get_context', 'Get Actor Control Context', 'Resolve the current actor control context and wrap the latest user input as an actor claim. Does not mutate state.', contextSchema(), false, true, ['actor-control', 'context', 'identity', 'no-llm']),
    tool('build_prompt_context', 'Build Actor Control Prompt Context', 'Build a prompt section that tells LLMs which actor the user controls and that ordinary chat is not canonical world fact.', contextSchema(), false, true, ['actor-control', 'prompt', 'identity', 'no-llm']),
    tool('wrap_input', 'Wrap Input With Actor Authority', 'Wrap text with actor title and fact authority metadata without reading or writing canonical facts.', wrapSchema(), false, true, ['actor-control', 'input', 'authority', 'no-llm']),
    tool('set_context', 'Set Actor Control Context', 'Bind the current chat to a player-controlled actor selected by the frontend/user. Requires explicit user authorization.', setContextSchema(), true, false, ['actor-control', 'bind', 'write']),
    tool('clear_context', 'Clear Actor Control Context', 'Clear the explicit actor control binding for a chat. Requires explicit user authorization.', clearSchema(), true, false, ['actor-control', 'clear', 'write'])
  ]
};

export function createActorControlHandlers({ appDatabase, dataManager, manager, actorState, trace } = {}) {
  const actorControl = manager || new ActorControlContextManager({
    appDatabase,
    dataManager,
    actorState,
    trace
  });
  return {
    describe_manager: async ({ input }) => actorControl.describe(input.chatSessionId),
    get_context: async ({ input }) => actorControl.getContext(input),
    build_prompt_context: async ({ input }) => actorControl.buildPromptContext(input),
    wrap_input: async ({ input }) => actorControl.wrapInput(input),
    set_context: async ({ input }) => actorControl.setContext(input),
    clear_context: async ({ input }) => actorControl.clearContext(input)
  };
}

function tool(name, title, description, inputSchema, mutatesState, autoCallable, tags) {
  return {
    name,
    title,
    description,
    inputSchema,
    visibility: 'public',
    autoCallable,
    mutatesState,
    annotations: mutatesState ? { requiresUserAuthorization: true } : {},
    metadata: {
      scope: 'chat-session',
      llm: false,
      writesTrace: mutatesState,
      requiresUserAuthorization: mutatesState
    },
    tags
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

function contextSchema() {
  return {
    type: 'object',
    properties: commonProperties(),
    anyOf: [
      { required: ['chatSessionId'] },
      { required: ['chatId'] },
      { required: ['sessionId'] }
    ],
    additionalProperties: false
  };
}

function wrapSchema() {
  return {
    type: 'object',
    properties: {
      ...commonProperties(),
      context: { type: 'object', additionalProperties: true }
    },
    anyOf: [
      { required: ['chatSessionId'] },
      { required: ['chatId'] },
      { required: ['sessionId'] }
    ],
    additionalProperties: false
  };
}

function setContextSchema() {
  return {
    type: 'object',
    properties: {
      ...commonProperties(),
      operation: { type: 'string' },
      reason: { type: 'string' }
    },
    anyOf: [
      { required: ['chatSessionId', 'controlledActorId'] },
      { required: ['chatId', 'controlledActorId'] },
      { required: ['sessionId', 'controlledActorId'] },
      { required: ['chatSessionId', 'playerActorId'] },
      { required: ['chatId', 'playerActorId'] },
      { required: ['sessionId', 'playerActorId'] },
      { required: ['chatSessionId', 'protagonistActorId'] },
      { required: ['chatId', 'protagonistActorId'] },
      { required: ['sessionId', 'protagonistActorId'] }
    ],
    additionalProperties: false
  };
}

function clearSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string' },
      reason: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function commonProperties() {
  return {
    chatSessionId: { type: 'string' },
    chatId: { type: 'string' },
    sessionId: { type: 'string' },
    sceneId: { type: 'string', default: 'current' },
    currentSceneId: { type: 'string' },
    text: { type: 'string' },
    currentInput: { type: 'string' },
    userInput: { type: 'string' },
    query: { type: 'string' },
    actorControl: { type: 'object', additionalProperties: true },
    controlledActorId: { type: 'string' },
    playerActorId: { type: 'string' },
    protagonistActorId: { type: 'string' },
    controlledActorTitle: { type: 'string' },
    playerActorTitle: { type: 'string' },
    actorTitle: { type: 'string' },
    title: { type: 'string' },
    name: { type: 'string' },
    controlledPlayerId: { type: 'string' },
    playerId: { type: 'string' },
    viewpointActorId: { type: 'string' },
    viewpointActorTitle: { type: 'string' },
    embodiedActorId: { type: 'string' },
    embodiedActorTitle: { type: 'string' },
    speakerRole: { type: 'string' },
    inputAuthority: {
      type: 'string',
      enum: ['actor_claim', 'canonical_user_edit', 'resolver_result', 'tool_result', 'import', 'system']
    },
    worldEditMode: { type: 'boolean' },
    canAssertWorldFacts: { type: 'boolean' },
    canAssertNpcDecisions: { type: 'boolean' },
    aiRole: { type: 'string' },
    userRole: { type: 'string' },
    aiAllowedSpeakers: stringListSchema(),
    aiForbiddenControl: stringListSchema(),
    factWriteChannels: stringListSchema(),
    source: { type: 'string' },
    metadata: { type: 'object', additionalProperties: true }
  };
}

function stringListSchema() {
  return {
    anyOf: [
      { type: 'array', items: { type: 'string' } },
      { type: 'string' }
    ]
  };
}
