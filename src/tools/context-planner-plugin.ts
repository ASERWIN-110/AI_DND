// @ts-nocheck
import { ContextPlanner } from '../context/context-planner.js';

export const CONTEXT_PLANNER_PLUGIN = {
  id: 'system.context_planner',
  name: 'Context Planner Tools',
  version: '0.1.0',
  description: 'No-LLM prompt context budget planner that selects scene NPCs, maps, quests, memory, RAG, recent messages, and compressed summaries for the next model call.',
  enabled: true,
  permissions: ['context:read', 'context:plan'],
  metadata: {
    llm: false,
    writesTrace: true
  },
  tools: [
    {
      name: 'describe_planner',
      title: 'Describe Context Planner',
      description: 'Return Context Planner sources, default priorities, source budgets, and trace behavior.',
      inputSchema: emptySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['context', 'prompt', 'budget', 'no-llm']
    },
    {
      name: 'plan_context',
      title: 'Plan Prompt Context',
      description: 'Collect available context sources and produce a token-budgeted promptContext block plus explicit selected/omitted sections and trace files.',
      inputSchema: planContextSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      metadata: {
        scope: 'chat-session',
        writesTrace: true
      },
      tags: ['context', 'prompt', 'budget', 'rag', 'memory', 'scene', 'no-llm']
    }
  ]
};

export function createContextPlannerHandlers({ toolManager, appDatabase, planner, trace } = {}) {
  const contextPlanner = planner || new ContextPlanner({
    toolManager,
    appDatabase,
    trace
  });
  return {
    describe_planner: async () => contextPlanner.describe(),
    plan_context: async ({ input }) => contextPlanner.planContext(input)
  };
}

function emptySchema() {
  return {
    type: 'object',
    properties: {},
    additionalProperties: false
  };
}

function planContextSchema() {
  return {
    type: 'object',
    properties: {
      planId: { type: 'string' },
      chatSessionId: { type: 'string' },
      chatId: { type: 'string' },
      sessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      query: { type: 'string' },
      text: { type: 'string' },
      currentInput: { type: 'string' },
      sourceText: { type: 'string' },
      messages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            role: { type: 'string' },
            name: { type: 'string' },
            content: { type: 'string' },
            metadata: { type: 'object', additionalProperties: true },
            createdAt: { type: 'string' },
            orderIndex: { type: 'integer' }
          },
          required: ['content'],
          additionalProperties: true
        }
      },
      maxContextTokens: { type: 'integer', minimum: 1, default: 6000 },
      reservedResponseTokens: { type: 'integer', minimum: 0 },
      recentMessageCount: { type: 'integer', minimum: 0, maximum: 500, default: 12 },
      sourceBudgets: numberMapSchema(),
      sourcePriorities: numberMapSchema(),
      includeSceneNpcs: { type: 'boolean', default: true },
      includeNpcProfiles: { type: 'boolean', default: true },
      includeNpcStates: { type: 'boolean', default: true },
      includeCurrentMap: { type: 'boolean', default: true },
      includeMapState: { type: 'boolean', default: true },
      includeQuests: { type: 'boolean', default: true },
      includeCharacterMemory: { type: 'boolean', default: true },
      includePermanentRag: { type: 'boolean', default: true },
      includeRuntimeRag: { type: 'boolean', default: true },
      includeRecentMessages: { type: 'boolean', default: true },
      includeCompression: { type: 'boolean', default: true },
      includeInactiveSceneObjects: { type: 'boolean', default: false },
      permanentRagCollection: { type: 'string' },
      runtimeRagCollection: { type: 'string' },
      ragCollection: { type: 'string' },
      ragLimit: { type: 'integer', minimum: 1, maximum: 50 },
      permanentRagLimit: { type: 'integer', minimum: 1, maximum: 50 },
      runtimeRagLimit: { type: 'integer', minimum: 1, maximum: 50 },
      minScore: { type: 'number' },
      ragFilter: { type: 'object', additionalProperties: true },
      memoryLimitPerCharacter: { type: 'integer', minimum: 0, maximum: 500 },
      compressionSummaryLimit: { type: 'integer', minimum: 0, maximum: 500 },
      pinnedLimit: { type: 'integer', minimum: 0, maximum: 500 },
      questLimit: { type: 'integer', minimum: 1, maximum: 500 },
      npcLimit: { type: 'integer', minimum: 1, maximum: 500 },
      mapLimit: { type: 'integer', minimum: 1, maximum: 500 },
      mapStateLimit: { type: 'integer', minimum: 1, maximum: 500 },
      npcStateLimit: { type: 'integer', minimum: 1, maximum: 500 },
      profileLevels: {
        anyOf: [
          { type: 'array', items: { type: 'string' } },
          { type: 'string' }
        ]
      },
      profileLimit: { type: 'integer', minimum: 1, maximum: 500 },
      sceneNpcQuery: { type: 'string' },
      questQuery: { type: 'string' }
    },
    anyOf: [
      { required: ['chatSessionId'] },
      { required: ['chatId'] },
      { required: ['sessionId'] }
    ],
    additionalProperties: false
  };
}

function numberMapSchema() {
  return {
    type: 'object',
    additionalProperties: {
      type: 'number'
    }
  };
}
