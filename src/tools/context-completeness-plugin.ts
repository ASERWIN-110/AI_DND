// @ts-nocheck
import { ContextCompletenessPlanner } from '../context/context-completeness-planner.js';

export const CONTEXT_COMPLETENESS_PLUGIN = {
  id: 'system.context_completeness',
  name: 'Context Completeness Tools',
  version: '0.1.0',
  description: 'No-LLM context completeness planner that decides when to upgrade from L0/L1/L2/L3 and RAG, then returns missing-awareness hints for adjudication and narrative.',
  enabled: true,
  permissions: ['context:read', 'context:plan'],
  metadata: {
    llm: false,
    writesTrace: true
  },
  tools: [
    tool('describe_policy', 'Describe Context Completeness Policy', 'Describe L0/L1/L2/L3/RAG escalation policy, missing policies, and gap-probe behavior.', emptySchema(), ['context', 'completeness', 'policy', 'no-llm']),
    tool('assess_need', 'Assess Context Need', 'Determine which L0/L1/L2/L3/RAG layers should be queried for the current intent, risk, actors, and user input. Does not call LLM or mutate state.', assessmentSchema(), ['context', 'completeness', 'planning', 'no-llm']),
    tool('resolve_context', 'Resolve Complete Context', 'Query required context layers, use RAG as evidence and gap probe, call Context Planner for prompt budgeting, and return missing-awareness hints.', resolveSchema(), ['context', 'completeness', 'rag', 'npc', 'prompt', 'no-llm']),
    tool('explain_plan', 'Explain Context Plan', 'Explain a context completeness assessment or build and explain one from the supplied input.', explainSchema(), ['context', 'completeness', 'debug', 'no-llm'])
  ]
};

export function createContextCompletenessHandlers({ toolManager, appDatabase, planner, trace } = {}) {
  const contextCompleteness = planner || new ContextCompletenessPlanner({
    toolManager,
    appDatabase,
    trace
  });
  return {
    describe_policy: async () => contextCompleteness.describePolicy(),
    assess_need: async ({ input }) => contextCompleteness.assessNeed(input),
    resolve_context: async ({ input }) => contextCompleteness.resolveContext(input),
    explain_plan: async ({ input }) => contextCompleteness.explainPlan(input)
  };
}

function tool(name, title, description, inputSchema, tags) {
  return {
    name,
    title,
    description,
    inputSchema,
    visibility: 'public',
    autoCallable: true,
    mutatesState: false,
    metadata: {
      scope: 'chat-session',
      writesTrace: name === 'resolve_context'
    },
    tags
  };
}

function emptySchema() {
  return {
    type: 'object',
    properties: {},
    additionalProperties: false
  };
}

function assessmentSchema() {
  return {
    type: 'object',
    properties: commonProperties(false),
    additionalProperties: false
  };
}

function resolveSchema() {
  return {
    type: 'object',
    properties: {
      ...commonProperties(true),
      assessment: { type: 'object', additionalProperties: true },
      includeSceneActors: { type: 'boolean', default: true },
      includeInactiveSceneObjects: { type: 'boolean', default: false },
      includeRag: { type: 'boolean', default: true },
      includePermanentRag: { type: 'boolean', default: true },
      includeRuntimeRag: { type: 'boolean', default: true },
      forceRag: { type: 'boolean' },
      ragProbe: { type: 'boolean', default: true },
      useContextPlanner: { type: 'boolean', default: true },
      contextPlannerInput: { type: 'object', additionalProperties: true },
      maxContextTokens: { type: 'integer', minimum: 1, default: 6000 },
      recentMessageCount: { type: 'integer', minimum: 0, maximum: 500, default: 12 },
      actorLimit: { type: 'integer', minimum: 1, maximum: 500 },
      sceneNpcLimit: { type: 'integer', minimum: 1, maximum: 500 },
      profileLimit: { type: 'integer', minimum: 1, maximum: 10 },
      npcStateLimit: { type: 'integer', minimum: 1, maximum: 500 },
      relationshipDepth: { type: 'integer', minimum: 0, maximum: 8 },
      relationshipLimit: { type: 'integer', minimum: 1, maximum: 500 },
      factionLimit: { type: 'integer', minimum: 1, maximum: 500 },
      ragLimit: { type: 'integer', minimum: 1, maximum: 50 },
      minScore: { type: 'number' },
      ragFilter: { type: 'object', additionalProperties: true },
      ragCollection: { type: 'string' },
      permanentRagCollection: { type: 'string' },
      runtimeRagCollection: { type: 'string' }
    },
    anyOf: [
      { required: ['chatSessionId'] },
      { required: ['chatId'] },
      { required: ['sessionId'] }
    ],
    additionalProperties: false
  };
}

function explainSchema() {
  return {
    type: 'object',
    properties: {
      ...commonProperties(false),
      assessment: { type: 'object', additionalProperties: true }
    },
    additionalProperties: false
  };
}

function commonProperties(includeChatAliases) {
  return {
    planId: { type: 'string' },
    chatSessionId: { type: 'string' },
    ...(includeChatAliases ? {
      chatId: { type: 'string' },
      sessionId: { type: 'string' }
    } : {}),
    sceneId: { type: 'string', default: 'current' },
    query: { type: 'string' },
    text: { type: 'string' },
    currentInput: { type: 'string' },
    sourceText: { type: 'string' },
    playerInput: { type: 'string' },
    intent: stringListSchema(),
    intents: stringListSchema(),
    actorIds: stringListSchema(),
    actors: stringListSchema(),
    npcIds: stringListSchema(),
    npcs: stringListSchema(),
    targetActorIds: stringListSchema(),
    targetNpcIds: stringListSchema(),
    riskHint: { type: 'string' },
    risk: { type: 'string' },
    riskLevel: { type: 'string' },
    requestedOutcome: { type: 'string' },
    includeRag: { type: 'boolean' },
    importance: { type: 'string' },
    actorImportance: { type: 'string' },
    importanceHint: { type: 'string' },
    requiredLevels: stringListSchema(),
    profileLevels: stringListSchema(),
    missingPolicy: {
      type: 'string',
      enum: ['report_only', 'ask_user', 'generate_ephemeral', 'generate_persistent'],
      default: 'report_only'
    }
  };
}

function stringListSchema() {
  return {
    anyOf: [
      { type: 'string' },
      { type: 'array', items: { type: 'string' } }
    ]
  };
}
