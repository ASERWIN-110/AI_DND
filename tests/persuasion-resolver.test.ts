// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppDatabase,
  DICE_PLUGIN,
  PERSUASION_PLUGIN,
  PersuasionResolver,
  ToolPluginManager,
  createDefaultToolPluginManager,
  createPersuasionHandlers
} from '../src/index.js';

class JsonProvider {
  constructor(response) {
    this.response = response;
    this.calls = [];
  }

  async generate(request) {
    this.calls.push(request);
    return {
      content: JSON.stringify(this.response),
      raw: { provider: 'json-test' }
    };
  }
}

function createTestChat() {
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
  const character = appDatabase.importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Persuasion GM',
      first_mes: 'Begin.'
    }
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Persuasion Test',
    includeGreeting: false
  }).session;
  return { appDatabase, chat };
}

test('persuasion resolver asks LLM to judge player speech into inspectable modifiers', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-persuasion-'));
  const provider = new JsonProvider({
    status: 'judged',
    targetNpcId: 'npc_guard',
    speakerId: 'pc_arin',
    reasoningQuality: 'strong',
    argumentBonus: 6,
    dcAdjustment: -1,
    confidence: 0.9,
    summary: 'The speech cites the guard captain and gives the guard a low-risk way to help.',
    factors: [
      { name: 'evidence', effect: 'helps', modifier: 3, note: 'Specific token and name.' },
      { name: 'risk', effect: 'helps', modifier: 2, note: 'The ask protects the guard from blame.' }
    ],
    narrationHints: {
      success: 'The guard relents but asks for discretion.',
      failure: 'The guard hesitates and asks for proof.'
    }
  });
  const tools = new ToolPluginManager({ trace: false });
  const resolver = new PersuasionResolver({
    toolManager: tools,
    chatProvider: provider,
    trace: { directory: join(directory, 'traces') }
  });
  tools.createPlugin(PERSUASION_PLUGIN, {
    handlers: createPersuasionHandlers({ resolver })
  });

  try {
    const result = await tools.executeTool('system.persuasion.judge_argument', {
      targetNpcId: 'npc_guard',
      speakerId: 'pc_arin',
      sourceText: '我请求守卫放我们进去调查。',
      playerSpeech: '队长让我带这枚令牌进去确认火灾源头；你守在门口，没人会怪到你头上。',
      successThreshold: 15,
      useLlm: true
    });

    assert.equal(provider.calls.length, 1);
    assert.match(provider.calls[0].messages[1].content, /Direct player speech/);
    assert.equal(result.output.judgement.argumentBonus, 6);
    assert.equal(result.output.judgement.dcAdjustment, -1);
    assert.equal(result.output.judgement.reasoningQuality, 'strong');
    assert.equal(existsSync(result.output.trace.files.prompt), true);
    assert.equal(existsSync(result.output.trace.files.judgement), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('persuasion combination lets strong speech rescue weak rolls and bad speech ruin good rolls', async () => {
  const tools = new ToolPluginManager({ trace: false });
  const resolver = new PersuasionResolver({ toolManager: tools, trace: false });

  const rescued = await resolver.combine({
    successThreshold: 15,
    diceResult: {
      outcome: 'failure',
      total: 10,
      criticalFailure: false
    },
    judgement: {
      reasoningQuality: 'excellent',
      argumentBonus: 6,
      dcAdjustment: -1,
      summary: 'The player offered direct evidence and protected the target from risk.'
    }
  });
  assert.equal(rescued.resolution.outcome, 'success');
  assert.equal(rescued.resolution.effectiveTotal, 16);
  assert.equal(rescued.resolution.effectiveThreshold, 14);

  const ruined = await resolver.combine({
    successThreshold: 15,
    diceResult: {
      outcome: 'success',
      total: 18,
      criticalSuccess: false
    },
    judgement: {
      reasoningQuality: 'poor',
      argumentBonus: -6,
      dcAdjustment: 1,
      summary: 'The player insulted the target and contradicted known facts.'
    }
  });
  assert.equal(ruined.resolution.outcome, 'failure');
  assert.equal(ruined.resolution.effectiveTotal, 12);
  assert.equal(ruined.resolution.effectiveThreshold, 16);
});

test('persuasion resolve can roll through dice tool and default manager registers tools', async () => {
  const tools = new ToolPluginManager({ trace: false });
  tools.createPlugin(DICE_PLUGIN, {
    handlers: {
      check: async ({ input }) => ({
        outcome: 'failure',
        success: false,
        failure: true,
        critical: false,
        criticalSuccess: false,
        criticalFailure: false,
        total: 12,
        successThreshold: input.successThreshold,
        rolls: [8],
        modifierTotal: 4
      })
    }
  });
  const resolver = new PersuasionResolver({ toolManager: tools, trace: false });
  tools.createPlugin(PERSUASION_PLUGIN, {
    handlers: createPersuasionHandlers({ resolver })
  });

  const resolved = await tools.executeTool('system.persuasion.resolve', {
    sourceText: '我说服守卫放行。',
    targetNpcId: 'npc_guard',
    successThreshold: 15,
    diceSides: 20,
    diceCount: 1,
    judgement: {
      status: 'judged',
      reasoningQuality: 'strong',
      argumentBonus: 3,
      dcAdjustment: 0,
      summary: 'Good enough to turn a near miss into success.'
    }
  });

  assert.equal(resolved.output.dice.output.total, 12);
  assert.equal(resolved.output.resolution.effectiveTotal, 15);
  assert.equal(resolved.output.outcome, 'success');

  const { appDatabase } = createTestChat();
  try {
    const defaultTools = createDefaultToolPluginManager({ appDatabase, trace: false });
    assert.equal(defaultTools.getTool('system.persuasion.resolve').id, 'system.persuasion.resolve');
    assert.equal(defaultTools.getTool('system.persuasion.judge_argument').pluginId, 'system.persuasion');
  } finally {
    appDatabase.close();
  }
});
