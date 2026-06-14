// @ts-nocheck
import { EnvironmentBehaviorResolver } from '../actions/environment-behavior-resolver.js';

export const ENVIRONMENT_BEHAVIOR_PLUGIN = {
  id: 'system.environment_behavior',
  name: 'Environment Behavior Resolver Tools',
  version: '0.1.0',
  description: 'Mostly no-op autonomous environment behavior adjudication for prompt-salient scene hazards, destruction, alarms, weather, and map reactions.',
  enabled: true,
  permissions: ['environment-behavior:plan', 'environment-behavior:apply'],
  tools: [
    {
      name: 'describe_resolver',
      title: 'Describe Environment Behavior Resolver',
      description: 'Return resolver capabilities, templates, default allowed tools, probability policy, and safety semantics.',
      inputSchema: emptySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['environment', 'behavior', 'resolver', 'templates']
    },
    {
      name: 'list_templates',
      title: 'List Environment Behavior Templates',
      description: 'List editable environment behavior prompt and plan templates.',
      inputSchema: {
        type: 'object',
        properties: {
          templateId: { type: 'string' }
        },
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['environment', 'behavior', 'templates']
    },
    {
      name: 'build_prompt',
      title: 'Build Environment Behavior Prompt',
      description: 'Collect scene/map/time context, assess trigger probability, and write an editable environment behavior prompt trace.',
      inputSchema: environmentPromptInputSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['environment', 'behavior', 'prompt', 'context']
    },
    {
      name: 'plan',
      title: 'Plan Environment Behavior',
      description: 'Create or normalize an Environment Behavior Plan. It can use an LLM when explicitly requested; otherwise it usually returns a no-op plan.',
      inputSchema: {
        ...environmentPromptInputSchema(),
        properties: {
          ...environmentPromptInputSchema().properties,
          plan: { type: 'object', additionalProperties: true },
          planTemplate: { type: 'object', additionalProperties: true },
          useLlm: { type: 'boolean', default: false },
          temperature: { type: 'number' },
          maxTokens: { type: 'integer', minimum: 1, maximum: 12000 }
        }
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['environment', 'behavior', 'plan']
    },
    {
      name: 'apply_plan',
      title: 'Apply Environment Behavior Plan',
      description: 'Apply an existing Environment Behavior Plan through the standard Action Resolver executor. Defaults to dryRun=true.',
      inputSchema: environmentApplyInputSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        openWorld: true
      },
      tags: ['environment', 'behavior', 'apply', 'risk-report']
    },
    {
      name: 'resolve',
      title: 'Resolve Environment Behavior',
      description: 'Plan and apply environment behavior in one call. Defaults to dryRun=true so users can inspect consequences before execution.',
      inputSchema: {
        ...environmentPromptInputSchema(),
        properties: {
          ...environmentPromptInputSchema().properties,
          plan: { type: 'object', additionalProperties: true },
          planTemplate: { type: 'object', additionalProperties: true },
          useLlm: { type: 'boolean', default: false },
          dryRun: { type: 'boolean', default: true },
          allowedTools: allowedToolsSchema(),
          continueOnError: { type: 'boolean', default: false },
          temperature: { type: 'number' },
          maxTokens: { type: 'integer', minimum: 1, maximum: 12000 }
        }
      },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        openWorld: true
      },
      tags: ['environment', 'behavior', 'resolve', 'plan', 'apply']
    }
  ]
};

export function createEnvironmentBehaviorHandlers({ toolManager, resolver, chatProvider, trace } = {}) {
  const environmentBehavior = resolver || new EnvironmentBehaviorResolver({
    toolManager,
    chatProvider,
    trace
  });
  return {
    describe_resolver: async () => environmentBehavior.describe(),
    list_templates: async ({ input }) => {
      const description = environmentBehavior.describe();
      if (input.templateId) return description.templates[input.templateId] || undefined;
      return description.templates;
    },
    build_prompt: async ({ input }) => environmentBehavior.buildPrompt(input),
    plan: async ({ input }) => environmentBehavior.plan(input),
    apply_plan: async ({ input, context }) => environmentBehavior.applyPlan(input, { context }),
    resolve: async ({ input, context }) => environmentBehavior.resolve(input, { context })
  };
}

function environmentPromptInputSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      mapId: { type: 'string' },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      triggerText: { type: 'string' },
      triggerType: { type: 'string', default: 'scene_event' },
      triggerSummary: { type: 'string' },
      query: { type: 'string' },
      includeContext: { type: 'boolean', default: true },
      includeRag: { type: 'boolean', default: false },
      ragQuery: { type: 'string' },
      ragCollection: { type: 'string' },
      ragLimit: { type: 'integer', minimum: 1, maximum: 50 },
      ragFilter: { type: 'object', additionalProperties: true },
      templateId: { type: 'string', default: 'generic' },
      plannerPrompt: { type: 'string' },
      userRules: { type: 'string' },
      referenceText: { type: 'string' },
      referenceTexts: referenceTextsSchema(),
      referenceDocuments: referenceDocumentsSchema(),
      toolReferenceText: { type: 'string' },
      baseChance: { type: 'number' },
      environmentBaseChance: { type: 'number' },
      triggerThreshold: { type: 'number' },
      scenePressure: { type: 'number' },
      forceTrigger: { type: 'boolean' },
      triggered: { type: 'boolean' },
      disableTrigger: { type: 'boolean' },
      noTrigger: { type: 'boolean' },
      allowedTools: allowedToolsSchema()
    },
    additionalProperties: false
  };
}

function environmentApplyInputSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      mapId: { type: 'string' },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      triggerText: { type: 'string' },
      triggerType: { type: 'string', default: 'scene_event' },
      triggerSummary: { type: 'string' },
      plan: { type: 'object', additionalProperties: true },
      actionId: { type: 'string' },
      environmentBehaviorId: { type: 'string' },
      intent: { type: 'object', additionalProperties: true },
      environmentActors: { type: 'array', items: { type: 'object', additionalProperties: true } },
      triggerAssessment: { type: 'object', additionalProperties: true },
      checks: { type: 'array', items: { type: 'object', additionalProperties: true } },
      proposals: { type: 'array', items: { type: 'object', additionalProperties: true } },
      narrationHints: { type: 'object', additionalProperties: true },
      metadata: { type: 'object', additionalProperties: true },
      dryRun: { type: 'boolean', default: true },
      allowedTools: allowedToolsSchema(),
      continueOnError: { type: 'boolean', default: false }
    },
    additionalProperties: true
  };
}

function allowedToolsSchema() {
  return {
    anyOf: [
      { type: 'array', items: { type: 'string' } },
      { type: 'string' }
    ]
  };
}

function referenceTextsSchema() {
  return {
    anyOf: [
      { type: 'string' },
      { type: 'array', items: { type: 'string' } }
    ]
  };
}

function referenceDocumentsSchema() {
  return {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        text: { type: 'string' },
        body: { type: 'string' },
        summary: { type: 'string' }
      },
      additionalProperties: true
    }
  };
}

function emptySchema() {
  return {
    type: 'object',
    properties: {},
    additionalProperties: false
  };
}
