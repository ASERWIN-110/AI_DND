// @ts-nocheck
import { PersuasionResolver } from '../social/persuasion-resolver.js';

export const PERSUASION_PLUGIN = {
  id: 'system.persuasion',
  name: 'Persuasion Adjudication Tools',
  version: '0.1.0',
  description: 'LLM-assisted social persuasion adjudication: judge player speech/context into modifiers, then combine with dice deterministically.',
  enabled: true,
  permissions: ['persuasion:judge', 'persuasion:resolve'],
  metadata: {
    mutatesState: false,
    usesLlmWhenRequested: true,
    diceTool: 'game.dice.check'
  },
  tools: [
    {
      name: 'describe_resolver',
      title: 'Describe Persuasion Resolver',
      description: 'Describe the LLM persuasion judgement workflow, scoring model, and output shape.',
      inputSchema: emptySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['persuasion', 'social', 'llm', 'dice', 'templates']
    },
    {
      name: 'build_prompt',
      title: 'Build Persuasion Judgement Prompt',
      description: 'Collect context and build an editable LLM prompt for judging player speech/reasoning before dice are combined.',
      inputSchema: persuasionInputSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['persuasion', 'prompt', 'context', 'social']
    },
    {
      name: 'judge_argument',
      title: 'Judge Persuasion Argument',
      description: 'Use an LLM when useLlm=true, or normalize a supplied judgement, to produce argumentBonus and dcAdjustment.',
      inputSchema: {
        ...persuasionInputSchema(),
        properties: {
          ...persuasionInputSchema().properties,
          judgement: { type: 'object', additionalProperties: true },
          persuasionJudgement: { type: 'object', additionalProperties: true },
          useLlm: { type: 'boolean', default: false },
          temperature: { type: 'number' },
          maxTokens: { type: 'integer', minimum: 1, maximum: 12000 }
        }
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['persuasion', 'judge', 'llm', 'argument']
    },
    {
      name: 'combine_result',
      title: 'Combine Persuasion Dice And Judgement',
      description: 'Pure deterministic combination of supplied diceResult and persuasion judgement. Does not call LLM or roll dice.',
      inputSchema: combineSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['persuasion', 'combine', 'dice', 'deterministic']
    },
    {
      name: 'resolve',
      title: 'Resolve Persuasion',
      description: 'Judge persuasion argument, roll or accept dice, then deterministically combine them. Does not mutate NPC/faction state.',
      inputSchema: {
        ...persuasionInputSchema(),
        properties: {
          ...persuasionInputSchema().properties,
          judgement: { type: 'object', additionalProperties: true },
          persuasionJudgement: { type: 'object', additionalProperties: true },
          diceResult: { type: 'object', additionalProperties: true },
          rollResult: { type: 'object', additionalProperties: true },
          rollDice: { type: 'boolean', default: true },
          diceInput: { type: 'object', additionalProperties: true },
          diceCount: { type: 'integer', minimum: 1, maximum: 100 },
          rollCount: { type: 'integer', minimum: 1, maximum: 100 },
          diceSides: { type: 'integer', minimum: 2, maximum: 10000 },
          sides: { type: 'integer', minimum: 2, maximum: 10000 },
          modifier: { type: 'integer' },
          fixedModifier: { type: 'integer' },
          buff: { type: 'integer' },
          debuff: { type: 'integer' },
          abilityModifier: { type: 'integer' },
          proficiencyBonus: { type: 'integer' },
          modifiers: {
            type: 'array',
            items: { type: 'object', additionalProperties: true }
          },
          forceMode: { type: 'string', enum: ['normal', 'success', 'failure', 'criticalSuccess', 'criticalFailure'] },
          rollMode: { type: 'string', enum: ['normal', 'advantage', 'disadvantage'] },
          inspirationPoints: { type: 'integer', minimum: 0, maximum: 20 },
          criticalMode: { type: 'string', enum: ['none', 'd20', 'maxTotal', 'minTotal'] },
          criticalPolicy: { type: 'string', enum: ['argumentCanOverride', 'diceLocked'] },
          useLlm: { type: 'boolean', default: false },
          temperature: { type: 'number' },
          maxTokens: { type: 'integer', minimum: 1, maximum: 12000 }
        }
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      metadata: {
        scope: 'chat-session',
        writesTrace: true
      },
      tags: ['persuasion', 'resolve', 'dice', 'llm', 'social']
    }
  ]
};

export function createPersuasionHandlers({ toolManager, resolver, chatProvider, trace } = {}) {
  const persuasion = resolver || new PersuasionResolver({
    toolManager,
    chatProvider,
    trace
  });
  return {
    describe_resolver: async () => persuasion.describe(),
    build_prompt: async ({ input }) => persuasion.buildPrompt(input),
    judge_argument: async ({ input }) => persuasion.judgeArgument(input),
    combine_result: async ({ input }) => persuasion.combine(input),
    resolve: async ({ input }) => persuasion.resolve(input)
  };
}

function emptySchema() {
  return {
    type: 'object',
    properties: {},
    additionalProperties: false
  };
}

function persuasionInputSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      query: { type: 'string' },
      targetNpcId: { type: 'string' },
      npcId: { type: 'string' },
      targetId: { type: 'string' },
      target: { type: 'object', additionalProperties: true },
      speakerId: { type: 'string' },
      speakerNpcId: { type: 'string' },
      actorId: { type: 'string' },
      playerId: { type: 'string' },
      speaker: { type: 'object', additionalProperties: true },
      playerSpeech: { type: 'string' },
      speech: { type: 'string' },
      argument: { type: 'string' },
      personalPersuasion: { type: 'string' },
      directSpeech: { type: 'string' },
      desiredOutcome: { type: 'string' },
      stakes: { type: 'string' },
      successThreshold: { type: 'integer' },
      dc: { type: 'integer' },
      baseThreshold: { type: 'integer' },
      userRules: { type: 'string' },
      persuasionPrompt: { type: 'string' },
      includeContext: { type: 'boolean', default: true },
      includeRag: { type: 'boolean', default: false },
      ragQuery: { type: 'string' },
      ragCollection: { type: 'string' },
      ragLimit: { type: 'integer', minimum: 1, maximum: 50 },
      ragFilter: { type: 'object', additionalProperties: true },
      context: { type: 'object', additionalProperties: true },
      includeDiceInPrompt: { type: 'boolean', default: false }
    },
    additionalProperties: false
  };
}

function combineSchema() {
  return {
    type: 'object',
    properties: {
      successThreshold: { type: 'integer' },
      dc: { type: 'integer' },
      baseThreshold: { type: 'integer' },
      diceInput: { type: 'object', additionalProperties: true },
      diceResult: { type: 'object', additionalProperties: true },
      rollResult: { type: 'object', additionalProperties: true },
      dice: { type: 'object', additionalProperties: true },
      judgement: { type: 'object', additionalProperties: true },
      persuasionJudgement: { type: 'object', additionalProperties: true },
      criticalPolicy: { type: 'string', enum: ['argumentCanOverride', 'diceLocked'] }
    },
    additionalProperties: false
  };
}
