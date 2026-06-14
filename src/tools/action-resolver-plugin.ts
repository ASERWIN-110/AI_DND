// @ts-nocheck
import { ActionResolver } from '../actions/action-resolver.js';

export const ACTION_RESOLVER_PLUGIN = {
  id: 'system.action',
  name: 'Action Resolver Tools',
  version: '0.1.0',
  description: 'Two-stage action adjudication workflow with a player appeal loop: collect context, build editable prompts, produce an Action Plan, apply planned tool calls with risk reports/traces, then ask the player to accept or rebut and rejudge.',
  enabled: true,
  permissions: ['action:plan', 'action:apply'],
  tools: [
    {
      name: 'describe_resolver',
      title: 'Describe Action Resolver',
      description: 'Return resolver capabilities, default allowed tools, permission model, and debug templates.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['action', 'resolver', 'templates']
    },
    {
      name: 'list_templates',
      title: 'List Action Templates',
      description: 'List editable prompt and plan templates for action adjudication. These are examples, not hard-coded rules.',
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
      tags: ['action', 'templates']
    },
    {
      name: 'build_prompt',
      title: 'Build Action Planner Prompt',
      description: 'Collect context and write an editable action planner prompt trace without creating or applying a plan.',
      inputSchema: actionPromptInputSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['action', 'prompt', 'context']
    },
    {
      name: 'plan',
      title: 'Plan Action',
      description: 'Create or normalize an Action Plan. It can use an LLM when explicitly requested, otherwise it returns a template/user-supplied plan.',
      inputSchema: {
        ...actionPromptInputSchema(),
        properties: {
          ...actionPromptInputSchema().properties,
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
      tags: ['action', 'plan']
    },
    {
      name: 'apply_plan',
      title: 'Apply Action Plan',
      description: 'Apply an existing Action Plan. Plan-embedded authorization is ignored; only outer tool context can authorize dangerous tools. Supports dryRun risk reports.',
      inputSchema: applyPlanInputSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        openWorld: true
      },
      tags: ['action', 'apply', 'risk-report']
    },
    {
      name: 'resolve',
      title: 'Resolve Action With Player Appeal Loop',
      description: 'Default action ruling entry. It plans/applies a ruling, returns the result, asks whether the player accepts it, and supports repeated player rebuttal/rejudgement cycles until accepted.',
      inputSchema: resolveWithAppealInputSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        openWorld: true,
        playerDecisionLoop: true,
        preferredResolver: true
      },
      tags: ['action', 'resolve', 'appeal', 'rejudgement', 'loop']
    },
    {
      name: 'resolve_once',
      title: 'Resolve Action Once Legacy',
      description: 'Legacy archived single-pass action resolver. It plans/applies once and does not ask the player to accept or rebut. Routers should use system.action.resolve instead.',
      inputSchema: resolveOnceInputSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        openWorld: true,
        legacy: true,
        archival: true,
        replacedBy: 'system.action.resolve'
      },
      tags: ['action', 'resolve', 'legacy', 'archive']
    },
    {
      name: 'resolve_with_appeal',
      title: 'Resolve Action With Player Appeal Loop',
      description: 'Compatibility alias for system.action.resolve. Run an action ruling, ask whether the player accepts it, and allow repeated player rebuttal/rejudgement cycles until accepted.',
      inputSchema: resolveWithAppealInputSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        openWorld: true,
        playerDecisionLoop: true,
        aliasFor: 'system.action.resolve'
      },
      tags: ['action', 'resolve', 'appeal', 'rejudgement', 'loop']
    },
    {
      name: 'build_absurdity_prompt',
      title: 'Build Absurdity Judgement Prompt',
      description: 'Collect context and build an editable prompt for relative absurdity judgement. This does not decide success or failure.',
      inputSchema: absurdityJudgementInputSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['action', 'absurdity', 'prompt']
    },
    {
      name: 'judge_absurdity',
      title: 'Judge Action Absurdity',
      description: 'Judge whether an action is relatively absurd in context. This is qualitative and never automatic failure.',
      inputSchema: {
        ...absurdityJudgementInputSchema(),
        properties: {
          ...absurdityJudgementInputSchema().properties,
          judgement: { type: 'object', additionalProperties: true },
          absurdityJudgement: { type: 'object', additionalProperties: true },
          useLlm: { type: 'boolean', default: false },
          temperature: { type: 'number' },
          maxTokens: { type: 'integer', minimum: 1, maximum: 12000 }
        }
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['action', 'absurdity', 'judge']
    },
    {
      name: 'build_absurdity_explanation_prompt',
      title: 'Build Absurdity Explanation Prompt',
      description: 'Build an editable prompt that explains a successful absurd action so the game can continue.',
      inputSchema: absurdityExplanationInputSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['action', 'absurdity', 'explanation', 'prompt']
    },
    {
      name: 'explain_absurdity',
      title: 'Explain Successful Absurdity',
      description: 'Generate or normalize a playable in-world explanation for a successful absurd action, with consequences and hooks.',
      inputSchema: {
        ...absurdityExplanationInputSchema(),
        properties: {
          ...absurdityExplanationInputSchema().properties,
          explanation: { type: 'object', additionalProperties: true },
          absurdityExplanation: { type: 'object', additionalProperties: true },
          useLlm: { type: 'boolean', default: false },
          temperature: { type: 'number' },
          maxTokens: { type: 'integer', minimum: 1, maximum: 12000 }
        }
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['action', 'absurdity', 'explanation']
    },
    {
      name: 'build_appeal_prompt',
      title: 'Build Rejudgement Appeal Prompt',
      description: 'Collect context and build an editable prompt for a player appeal against a GM/action ruling. This does not mutate state.',
      inputSchema: appealInputSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['action', 'appeal', 'rejudgement', 'prompt']
    },
    {
      name: 'request_rejudgement',
      title: 'Request Rejudgement',
      description: 'Create a structured rejudgement decision from a player appeal. It can use an LLM when explicitly requested, otherwise it returns a pending decision template.',
      inputSchema: {
        ...appealInputSchema(),
        properties: {
          ...appealInputSchema().properties,
          decision: { type: 'object', additionalProperties: true },
          revisedPlan: { type: 'object', additionalProperties: true },
          useLlm: { type: 'boolean', default: false },
          temperature: { type: 'number' },
          maxTokens: { type: 'integer', minimum: 1, maximum: 12000 }
        }
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['action', 'appeal', 'rejudgement', 'decision']
    },
    {
      name: 'apply_rejudgement',
      title: 'Apply Rejudgement',
      description: 'Apply an accepted rejudgement decision by reusing apply_plan on its revisedPlan. Defaults to dryRun=true and respects existing authorization rules.',
      inputSchema: applyRejudgementInputSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        openWorld: true
      },
      tags: ['action', 'appeal', 'rejudgement', 'apply', 'risk-report']
    }
  ]
};

export function createActionResolverHandlers({ toolManager, resolver, chatProvider, trace } = {}) {
  const actionResolver = resolver || new ActionResolver({
    toolManager,
    chatProvider,
    trace
  });
  return {
    describe_resolver: async () => actionResolver.describe(),
    list_templates: async ({ input }) => {
      const description = actionResolver.describe();
      if (input.templateId) return description.templates[input.templateId] || undefined;
      return description.templates;
    },
    build_prompt: async ({ input }) => actionResolver.buildPrompt(input),
    plan: async ({ input }) => actionResolver.plan(input),
    apply_plan: async ({ input, context }) => actionResolver.applyPlan(input, { context }),
    resolve: async ({ input, context }) => actionResolver.resolveWithAppeal(input, { context }),
    resolve_once: async ({ input, context }) => actionResolver.resolve(input, { context }),
    resolve_with_appeal: async ({ input, context }) => actionResolver.resolveWithAppeal(input, { context }),
    build_absurdity_prompt: async ({ input }) => actionResolver.buildAbsurdityPrompt(input),
    judge_absurdity: async ({ input }) => actionResolver.judgeAbsurdity(input),
    build_absurdity_explanation_prompt: async ({ input }) => actionResolver.buildAbsurdityExplanationPrompt(input),
    explain_absurdity: async ({ input }) => actionResolver.explainAbsurdity(input),
    build_appeal_prompt: async ({ input }) => actionResolver.buildAppealPrompt(input),
    request_rejudgement: async ({ input }) => actionResolver.requestRejudgement(input),
    apply_rejudgement: async ({ input, context }) => actionResolver.applyRejudgement(input, { context })
  };
}

function actionPromptInputSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      actorId: { type: 'string' },
      npcId: { type: 'string' },
      playerId: { type: 'string' },
      controlledActorId: { type: 'string' },
      protagonistActorId: { type: 'string' },
      actorName: { type: 'string' },
      playerName: { type: 'string' },
      actorIds: stringArraySchema(),
      npcIds: stringArraySchema(),
      targetId: { type: 'string' },
      targetNpcId: { type: 'string' },
      targetIds: stringArraySchema(),
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      query: { type: 'string' },
      ragQuery: { type: 'string' },
      includeContext: { type: 'boolean', default: true },
      includeRag: { type: 'boolean', default: false },
      ragCollection: { type: 'string' },
      ragLimit: { type: 'integer', minimum: 1, maximum: 50 },
      ragFilter: { type: 'object', additionalProperties: true },
      templateId: { type: 'string', default: 'generic' },
	      plannerPrompt: { type: 'string' },
	      userRules: { type: 'string' },
	      routerIntent: { type: 'object', additionalProperties: true },
	      actionPacing: { type: 'object', additionalProperties: true },
	      includeAbsurdity: { type: 'boolean', default: false },
      useAbsurdityLlm: { type: 'boolean', default: false },
      useAbsurdityExplanationLlm: { type: 'boolean', default: false },
      absurdityPrompt: { type: 'string' },
      absurdityRules: { type: 'string' },
      absurdityJudgement: { type: 'object', additionalProperties: true },
      absurdityExplanation: { type: 'object', additionalProperties: true },
      forceAbsurdityExplanation: { type: 'boolean', default: false },
      explainAbsurdityOnDryRun: { type: 'boolean', default: false },
      useModifierResolver: { type: 'boolean', default: true },
      applyModifiers: { type: 'boolean', default: true },
      semanticWritePlanning: { type: 'boolean', default: true },
      useSemanticWritePlanning: { type: 'boolean', default: true },
      useSemanticWriteLlm: { type: 'boolean' },
      semanticWriteLlm: { type: 'boolean' },
      useDatabaseWriteLlm: { type: 'boolean' },
      requireSemanticWriteLlm: { type: 'boolean', default: false },
      semanticWriteRules: { type: 'string' },
      databaseWriteRules: { type: 'string' },
      semanticWriteDecision: { type: 'object', additionalProperties: true },
      databaseWriteDecision: { type: 'object', additionalProperties: true },
      writeDecision: { type: 'object', additionalProperties: true },
      semanticWriteTemperature: { type: 'number' },
      semanticWriteMaxTokens: { type: 'integer', minimum: 1, maximum: 12000 },
      allowExternalApiInDryRun: { type: 'boolean', default: false },
      forceDice: { type: 'boolean', default: false },
      rollDice: { type: 'boolean', default: false },
      requireCheck: { type: 'boolean', default: false },
      alwaysRoll: { type: 'boolean', default: false },
      tone: { type: 'string' },
      allowedTools: allowedToolsSchema()
    },
    additionalProperties: false
  };
}

function applyPlanInputSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      plan: { type: 'object', additionalProperties: true },
      checks: { type: 'array', items: { type: 'object', additionalProperties: true } },
      proposals: { type: 'array', items: { type: 'object', additionalProperties: true } },
      stateChangeProposals: { type: 'array', items: { type: 'object', additionalProperties: true } },
      intent: { type: 'object', additionalProperties: true },
      narrationHints: { type: 'object', additionalProperties: true },
      metadata: { type: 'object', additionalProperties: true },
      dryRun: { type: 'boolean', default: false },
      allowedTools: allowedToolsSchema(),
      continueOnError: { type: 'boolean', default: false },
      semanticWritePlanning: { type: 'boolean', default: true },
      useSemanticWritePlanning: { type: 'boolean', default: true },
      useSemanticWriteLlm: { type: 'boolean' },
      semanticWriteLlm: { type: 'boolean' },
      useDatabaseWriteLlm: { type: 'boolean' },
      requireSemanticWriteLlm: { type: 'boolean', default: false },
      semanticWriteRules: { type: 'string' },
      databaseWriteRules: { type: 'string' },
      semanticWriteDecision: { type: 'object', additionalProperties: true },
      databaseWriteDecision: { type: 'object', additionalProperties: true },
      writeDecision: { type: 'object', additionalProperties: true },
      semanticWriteTemperature: { type: 'number' },
      semanticWriteMaxTokens: { type: 'integer', minimum: 1, maximum: 12000 },
      allowExternalApiInDryRun: { type: 'boolean', default: false }
    },
    additionalProperties: true
  };
}

function resolveOnceInputSchema() {
  return {
    ...actionPromptInputSchema(),
    properties: {
      ...actionPromptInputSchema().properties,
      plan: { type: 'object', additionalProperties: true },
      planTemplate: { type: 'object', additionalProperties: true },
      useLlm: { type: 'boolean', default: false },
      dryRun: { type: 'boolean', default: true },
      allowedTools: allowedToolsSchema(),
      continueOnError: { type: 'boolean', default: false },
      temperature: { type: 'number' },
      maxTokens: { type: 'integer', minimum: 1, maximum: 12000 }
    }
  };
}

function resolveWithAppealInputSchema() {
  return {
    type: 'object',
    properties: {
      ...actionPromptInputSchema().properties,
      action: { type: 'string', enum: ['start', 'appeal', 'accept'], default: 'start' },
      loopState: { type: 'object', additionalProperties: true },
      state: { type: 'object', additionalProperties: true },
      currentResolution: { type: 'object', additionalProperties: true },
      resolution: { type: 'object', additionalProperties: true },
      plan: { type: 'object', additionalProperties: true },
      planTemplate: { type: 'object', additionalProperties: true },
      useLlm: { type: 'boolean', default: false },
      useRejudgementLlm: { type: 'boolean' },
      dryRun: { type: 'boolean', default: true },
      allowedTools: allowedToolsSchema(),
      continueOnError: { type: 'boolean', default: false },
      temperature: { type: 'number' },
      maxTokens: { type: 'integer', minimum: 1, maximum: 12000 },
      playerArgument: { type: 'string' },
      additionalInfo: { type: 'string' },
      rebuttal: { type: 'string' },
      appealText: { type: 'string' },
      playerEvidence: {
        anyOf: [
          { type: 'array', items: {} },
          { type: 'string' }
        ]
      },
      requestedOutcome: { type: 'string' },
      originalRuling: { anyOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }] },
      originalResult: { anyOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }] },
      originalNarration: { type: 'string' },
      originalPlan: { type: 'object', additionalProperties: true },
      decision: { type: 'object', additionalProperties: true },
      revisedPlan: { type: 'object', additionalProperties: true },
      applyRejudgement: { type: 'boolean', default: true }
    },
    additionalProperties: false
  };
}

function absurdityJudgementInputSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      query: { type: 'string' },
      plan: { type: 'object', additionalProperties: true },
      context: { type: 'object', additionalProperties: true },
      includeContext: { type: 'boolean', default: true },
      includeRag: { type: 'boolean', default: false },
      ragQuery: { type: 'string' },
      ragCollection: { type: 'string' },
      ragLimit: { type: 'integer', minimum: 1, maximum: 50 },
      ragFilter: { type: 'object', additionalProperties: true },
      absurdityPrompt: { type: 'string' },
      userRules: { type: 'string' },
      absurdityRules: { type: 'string' },
      tone: { type: 'string' }
    },
    additionalProperties: false
  };
}

function absurdityExplanationInputSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      query: { type: 'string' },
      plan: { type: 'object', additionalProperties: true },
      judgement: { type: 'object', additionalProperties: true },
      absurdityJudgement: { type: 'object', additionalProperties: true },
      actionResult: { type: 'object', additionalProperties: true },
      result: { type: 'object', additionalProperties: true },
      apply: { type: 'object', additionalProperties: true },
      context: { type: 'object', additionalProperties: true },
      includeContext: { type: 'boolean', default: true },
      includeRag: { type: 'boolean', default: false },
      ragQuery: { type: 'string' },
      ragCollection: { type: 'string' },
      ragLimit: { type: 'integer', minimum: 1, maximum: 50 },
      ragFilter: { type: 'object', additionalProperties: true },
      explanationPrompt: { type: 'string' },
      userRules: { type: 'string' },
      tone: { type: 'string' }
    },
    additionalProperties: false
  };
}

function appealInputSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      originalActionText: { type: 'string' },
      originalPlan: { type: 'object', additionalProperties: true },
      plan: { type: 'object', additionalProperties: true },
      originalRuling: { anyOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }] },
      originalResult: { anyOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }] },
      originalNarration: { type: 'string' },
      playerArgument: { type: 'string' },
      playerEvidence: {
        anyOf: [
          { type: 'array', items: {} },
          { type: 'string' }
        ]
      },
      requestedOutcome: { type: 'string' },
      query: { type: 'string' },
      includeContext: { type: 'boolean', default: true },
      includeRag: { type: 'boolean', default: false },
      ragCollection: { type: 'string' },
      ragLimit: { type: 'integer', minimum: 1, maximum: 50 },
      ragFilter: { type: 'object', additionalProperties: true },
      appealPrompt: { type: 'string' },
      userRules: { type: 'string' }
    },
    additionalProperties: false
  };
}

function applyRejudgementInputSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      decision: { type: 'object', additionalProperties: true },
      appealId: { type: 'string' },
      status: { type: 'string' },
      summary: { type: 'string' },
      originalActionId: { type: 'string' },
      disputedRuling: { type: 'string' },
      playerArgument: { type: 'string' },
      requestedOutcome: { type: 'string' },
      findings: { type: 'array', items: { type: 'object', additionalProperties: true } },
      correction: { type: 'object', additionalProperties: true },
      revisedPlan: { type: 'object', additionalProperties: true },
      rollbackRecommendation: { type: 'object', additionalProperties: true },
      narrationGuidance: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      originalPlan: { type: 'object', additionalProperties: true },
      plan: { type: 'object', additionalProperties: true },
      dryRun: { type: 'boolean', default: true },
      allowedTools: allowedToolsSchema(),
      continueOnError: { type: 'boolean', default: false }
    },
    additionalProperties: false
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

function stringArraySchema() {
  return {
    anyOf: [
      { type: 'array', items: { type: 'string' } },
      { type: 'string' }
    ]
  };
}
