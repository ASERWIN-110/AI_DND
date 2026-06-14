// @ts-nocheck
import { NpcBehaviorResolver } from '../actions/npc-behavior-resolver.js';

export const NPC_BEHAVIOR_PLUGIN = {
  id: 'system.npc_behavior',
  name: 'NPC Behavior Resolver Tools',
  version: '0.1.0',
  description: 'Autonomous NPC behavior adjudication: collect context, build editable prompts, plan NPC actions, and optionally apply consequences through existing tools.',
  enabled: true,
  permissions: ['npc-behavior:plan', 'npc-behavior:apply'],
  tools: [
    {
      name: 'describe_resolver',
      title: 'Describe NPC Behavior Resolver',
      description: 'Return resolver capabilities, templates, default allowed tools, and safety semantics.',
      inputSchema: emptySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['npc', 'behavior', 'resolver', 'templates']
    },
    {
      name: 'list_templates',
      title: 'List NPC Behavior Templates',
      description: 'List editable NPC behavior prompt and plan templates.',
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
      tags: ['npc', 'behavior', 'templates']
    },
    {
      name: 'build_prompt',
      title: 'Build NPC Behavior Prompt',
      description: 'Collect NPC/faction/scene context and write an editable NPC behavior prompt trace without creating or applying a plan.',
      inputSchema: behaviorPromptInputSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['npc', 'behavior', 'prompt', 'context']
    },
    {
      name: 'plan',
      title: 'Plan NPC Behavior',
      description: 'Create or normalize an NPC Behavior Plan. It can use an LLM when explicitly requested, otherwise it returns a template/user-supplied plan.',
      inputSchema: {
        ...behaviorPromptInputSchema(),
        properties: {
          ...behaviorPromptInputSchema().properties,
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
      tags: ['npc', 'behavior', 'plan']
    },
    {
      name: 'apply_plan',
      title: 'Apply NPC Behavior Plan',
      description: 'Apply an existing NPC Behavior Plan through the standard Action Resolver executor. Defaults to dryRun=true.',
      inputSchema: behaviorApplyInputSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        openWorld: true
      },
      tags: ['npc', 'behavior', 'apply', 'risk-report']
    },
    {
      name: 'resolve',
      title: 'Resolve NPC Behavior',
      description: 'Plan and apply NPC behavior in one call. Defaults to dryRun=true so users can inspect consequences before execution.',
      inputSchema: {
        ...behaviorPromptInputSchema(),
        properties: {
          ...behaviorPromptInputSchema().properties,
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
      tags: ['npc', 'behavior', 'resolve', 'plan', 'apply']
    }
  ]
};

export function createNpcBehaviorHandlers({ toolManager, resolver, chatProvider, trace } = {}) {
  const npcBehavior = resolver || new NpcBehaviorResolver({
    toolManager,
    chatProvider,
    trace
  });
  return {
    describe_resolver: async () => npcBehavior.describe(),
    list_templates: async ({ input }) => {
      const description = npcBehavior.describe();
      if (input.templateId) return description.templates[input.templateId] || undefined;
      return description.templates;
    },
    build_prompt: async ({ input }) => npcBehavior.buildPrompt(input),
    plan: async ({ input }) => npcBehavior.plan(input),
    apply_plan: async ({ input, context }) => npcBehavior.applyPlan(input, { context }),
    resolve: async ({ input, context }) => npcBehavior.resolve(input, { context })
  };
}

function behaviorPromptInputSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      triggerText: { type: 'string' },
      triggerType: { type: 'string', default: 'scene_event' },
      triggerSummary: { type: 'string' },
      npcId: { type: 'string' },
      npcIds: stringArraySchema(),
      actorNpcIds: stringArraySchema(),
      factionId: { type: 'string' },
      factionIds: stringArraySchema(),
      factionQuery: { type: 'string' },
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
      allowedTools: allowedToolsSchema()
    },
    additionalProperties: false
  };
}

function behaviorApplyInputSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      triggerText: { type: 'string' },
      triggerType: { type: 'string', default: 'scene_event' },
      triggerSummary: { type: 'string' },
      npcId: { type: 'string' },
      npcIds: stringArraySchema(),
      actorNpcIds: stringArraySchema(),
      plan: { type: 'object', additionalProperties: true },
      actionId: { type: 'string' },
      npcBehaviorId: { type: 'string' },
      intent: { type: 'object', additionalProperties: true },
      actors: { type: 'array', items: { type: 'object', additionalProperties: true } },
      checks: { type: 'array', items: { type: 'object', additionalProperties: true } },
      proposals: { type: 'array', items: { type: 'object', additionalProperties: true } },
      factionImpacts: { type: 'array', items: { type: 'object', additionalProperties: true } },
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

function stringArraySchema() {
  return {
    anyOf: [
      { type: 'array', items: { type: 'string' } },
      { type: 'string' }
    ]
  };
}

function emptySchema() {
  return {
    type: 'object',
    properties: {},
    additionalProperties: false
  };
}
