// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppDatabase,
  EncounterManager,
  ENCOUNTER_PLUGIN,
  ToolPluginManager,
  createDefaultToolPluginManager,
  createEncounterHandlers
} from '../src/index.js';

function createTestChat(options = {}) {
  const appDatabase = new AppDatabase({
    databasePath: ':memory:',
    chatDataDirectory: options.chatDataDirectory
  });
  const character = appDatabase.importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Encounter GM',
      first_mes: 'Begin.'
    }
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Encounter Test',
    includeGreeting: false
  }).session;
  return { appDatabase, chat };
}

function jsonProvider(payload) {
  return {
    async generate({ messages }) {
      return {
        content: JSON.stringify(payload),
        raw: { provider: 'test-json', prompt: messages.at(-1)?.content }
      };
    }
  };
}

test('encounter manager creates luck-based encounters and converges them', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-encounters-'));
  const { appDatabase, chat } = createTestChat({ chatDataDirectory: directory });
  const encounters = new EncounterManager({
    appDatabase,
    chatProvider: jsonProvider({
      encounterId: 'moon_vendor',
      title: '月下商贩',
      status: 'triggered',
      encounterType: 'reward',
      entryText: '雾气散开，一个只在月光里开张的商贩拦住了队伍。',
      immediateSituation: '商贩愿意用一个旧传闻交换无害的小物件。',
      objective: '判断商贩的交易是否值得接受，并安全结束接触。',
      resolutionCriteria: [
        { id: 'trade_terms', text: '确认交易条件', required: true },
        { id: 'safe_exit', text: '安全离开或完成交易', required: true }
      ],
      rewardHints: ['一条关于废塔的传闻', '一次性月光护符'],
      failureImpact: { delayedEffects: ['商贩下次提高价格'] },
      resolutionBudget: 2
    }),
    trace: {
      directory: join(directory, 'encounter-traces')
    }
  });

  try {
    const luck = encounters.assessLuck({ total: 24, dc: 15 });
    assert.equal(luck.tier, 'favorable');

    const created = await encounters.createEncounter({
      chatSessionId: chat.id,
      sceneId: 'forest_road',
      luckCheck: { total: 24, dc: 15 },
      sceneContext: '夜晚的森林道路，队伍刚结束一次长休。',
      referenceTemplate: '好运时优先给线索、奖励或友善 NPC。',
      useLlm: true
    });

    assert.equal(created.encounter.data.encounterId, 'moon_vendor');
    assert.equal(created.encounter.data.status, 'triggered');
    assert.equal(created.encounter.data.noFreePunishmentRule, 1);
    assert.equal(created.llm.used, true);
    assert.equal(existsSync(created.trace.files.input), true);
    assert.match(created.prompt, /must not inflict damage/);

    const tick = await encounters.resolveTick({
      chatSessionId: chat.id,
      encounterId: 'moon_vendor',
      sourceText: '玩家询问价格，并确认不会拿走记忆或血液。',
      tick: {
        tickType: 'clue',
        summary: '商贩确认交易只需要一枚普通纽扣，并给出废塔传闻。',
        stateUpdates: [
          { criterionId: 'trade_terms', status: 'resolved', value: '代价是一枚普通纽扣' },
          { kind: 'fact', value: '废塔午夜会出现第二道影子' }
        ],
        budgetSpent: 1
      },
      dryRun: false
    });

    assert.equal(tick.encounter.data.budgetRemaining, 1);
    assert.equal(tick.encounter.data.resolutionCriteria.find((criterion) => criterion.id === 'trade_terms').status, 'resolved');
    assert.ok(tick.encounter.data.stateFacts.includes('废塔午夜会出现第二道影子'));

    const outcome = await encounters.checkOutcome({
      chatSessionId: chat.id,
      encounterId: 'moon_vendor',
      sourceText: '玩家完成交易并礼貌离开。',
      decision: {
        resolved: true,
        status: 'resolved',
        reason: '交易完成，队伍安全离开。',
        stateUpdates: [
          { criterionId: 'safe_exit', status: 'resolved', value: '安全离开' }
        ],
        rewardEligible: true,
        consequenceEligible: false
      },
      dryRun: false
    });

    assert.equal(outcome.encounter.data.status, 'resolved');
    assert.equal(outcome.decision.rewardEligible, true);
    assert.equal(outcome.decision.consequenceEligible, false);

    const reward = await encounters.planReward({
      chatSessionId: chat.id,
      encounterId: 'moon_vendor',
      rewardPlan: {
        rewardTier: 'moderate',
        rewards: ['废塔传闻', '月光护符'],
        rationale: '好运奇遇且无战斗失败。'
      }
    });
    assert.deepEqual(reward.rewardPlan.rewards, ['废塔传闻', '月光护符']);
  } finally {
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('encounter tools import, export, mutate records, and register by default', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-encounter-tools-'));
  const { appDatabase, chat } = createTestChat({ chatDataDirectory: directory });
  const encounterManager = new EncounterManager({
    appDatabase,
    trace: {
      directory: join(directory, 'encounter-traces')
    }
  });
  const tools = new ToolPluginManager({ trace: false });
  tools.createPlugin(ENCOUNTER_PLUGIN, {
    handlers: createEncounterHandlers({ manager: encounterManager })
  });

  try {
    const imported = await tools.executeTool('system.encounters.import_encounters', {
      chatSessionId: chat.id,
      format: 'yaml',
      text: [
        'encounterSystem:',
        '  records:',
        '    - encounterId: road_duel',
        '      title: 路边决斗',
        '      status: engaged',
        '      encounterType: combat',
        '      entryText: 两名剑客正在路边决斗，误把玩家当见证人。',
        '      objective: 让决斗不波及队伍，或选择一方介入。',
        '      resolutionCriteria:',
        '        - id: safety',
        '          text: 队伍未被误伤',
        '          required: true',
        '      resolutionBudget: 2'
      ].join('\n')
    });
    assert.equal(imported.output.count, 1);

    const event = await tools.executeTool('system.encounters.add_event', {
      chatSessionId: chat.id,
      encounterId: 'road_duel',
      eventType: 'progress_tick',
      tickType: 'choice',
      summary: '玩家喊停并要求双方说明争执。',
      budgetSpent: 1,
      stateUpdates: [
        { kind: 'fact', value: '争执来自一封伪造挑战书' }
      ]
    });
    assert.equal(event.output.encounter.data.budgetRemaining, 1);

    const listed = await tools.executeTool('system.encounters.list_encounters', {
      chatSessionId: chat.id,
      activeOnly: true
    });
    assert.equal(listed.output.records.length, 1);

    const exported = await tools.executeTool('system.encounters.export_encounters', {
      chatSessionId: chat.id,
      format: 'json'
    });
    assert.match(exported.output.text, /road_duel/);

    const defaultTools = createDefaultToolPluginManager({ appDatabase, trace: false });
    const ids = defaultTools.listTools().map((tool) => tool.id);
    assert.ok(ids.includes('system.encounters.create_encounter'));
    assert.ok(ids.includes('system.encounters.resolve_tick'));
    assert.ok(ids.includes('system.encounters.apply_reward'));
    assert.ok(ids.includes('system.encounters.apply_consequence'));
  } finally {
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('encounter reward application updates actor inventory and explicit world impact tools', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-encounter-apply-reward-'));
  const { appDatabase, chat } = createTestChat({ chatDataDirectory: directory });
  const tools = createDefaultToolPluginManager({
    appDatabase,
    trace: {
      encounters: {
        directory: join(directory, 'encounter-traces')
      }
    }
  });

  try {
    await tools.executeTool('system.encounters.upsert_encounter', {
      chatSessionId: chat.id,
      encounterId: 'moon_vendor',
      title: '月下商贩',
      status: 'resolved',
      sceneId: 'forest_road',
      encounterType: 'reward',
      entryText: '月下商贩已经出现。',
      immediateSituation: '交易完成。',
      objective: '安全完成交易。',
      rewardHints: ['月光护符']
    });
    await tools.executeTool('system.npc_state.patch_state', {
      chatSessionId: chat.id,
      sceneId: 'forest_road',
      npcId: 'pc_arin',
      inventory: {
        currency: { gold: 2 },
        items: []
      }
    });

    const applied = await tools.executeTool('system.encounters.apply_reward', {
      chatSessionId: chat.id,
      encounterId: 'moon_vendor',
      rewardActorId: 'pc_arin',
      rewardPlan: {
        rewardTier: 'moderate',
        rewards: [
          { id: 'moon_charm', name: '月光护符', quantity: 1 }
        ],
        currency: { gold: 3 },
        toolCalls: [
          {
            id: 'record_vendor_departure',
            tool: 'system.map_state.patch_state',
            input: {
              chatSessionId: chat.id,
              sceneId: 'forest_road',
              mapId: 'forest_road',
              objects: [
                { id: 'vendor_traces', name: '月光商贩留下的车辙', summary: '通向废塔方向。' }
              ],
              source: 'encounter-reward-test'
            }
          }
        ],
        rationale: '交易完成，奖励落库。'
      }
    });

    assert.equal(applied.output.rewardApplication.status, 'applied');
    assert.equal(applied.output.impactApplication.status, 'applied');
    assert.equal(applied.output.event.data.eventType, 'reward');

    const state = await tools.executeTool('system.npc_state.get_state', {
      chatSessionId: chat.id,
      sceneId: 'forest_road',
      npcId: 'pc_arin'
    });
    assert.equal(state.output.data.inventory.currency.gold, 5);
    assert.equal(state.output.data.inventory.items[0].id, 'moon_charm');

    const map = await tools.executeTool('system.map_state.get_state', {
      chatSessionId: chat.id,
      sceneId: 'forest_road',
      mapId: 'forest_road'
    });
    assert.equal(map.output.data.objects[0].id, 'vendor_traces');
  } finally {
    appDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
