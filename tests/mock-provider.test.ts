// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { MockChatProvider } from '../src/index.js';

test('mock provider distinguishes watch badge checks from generic door inspection', async () => {
  const provider = new MockChatProvider();
  const result = await provider.generate({
    messages: [
      {
        role: 'user',
        content: 'I kneel at the threshold and inspect the watch badge before stepping inside.'
      }
    ]
  });

  assert.match(result.content, /巡夜灯徽|徽章/);
  assert.doesNotMatch(result.content, /盐线和拖痕的方向/);
});

test('mock provider resolves different bronze-door actions with different results', async () => {
  const provider = new MockChatProvider();
  const first = await provider.generate({
    messages: [{ role: 'user', content: 'I inspect the salt line and drag marks without touching the bronze door.' }]
  });
  const second = await provider.generate({
    messages: [{ role: 'user', content: 'I mark the salt line with salt chalk and smell the black wax.' }]
  });

  const firstLines = first.content.split('\n');
  const secondLines = second.content.split('\n');
  const firstResult = firstLines.find((line) => line.includes('行动结果'));
  const secondResult = secondLines.find((line) => line.includes('行动结果'));
  assert.notEqual(firstResult, secondResult);
  assert.match(firstResult, /行动结果/);
  assert.match(secondResult, /行动结果/);
  assert.match(firstLines.at(-1), /^接下来：/);
  assert.match(secondLines.at(-1), /^接下来：/);
  assert.doesNotMatch(firstLines.at(-1), /\/|或/);
});

test('mock provider follows automatic progress resolver grounding', async () => {
  const provider = new MockChatProvider();
  const result = await provider.generate({
    messages: [{
      role: 'user',
      content: [
        '# Current Input',
        '[玩家角色：Debug PC/pc_debug | authority=actor_claim] 去修炼入门功法，领取俸禄。',
        '',
        '# Raw Input',
        '去修炼入门功法，领取俸禄。',
        '',
        '# Resolver Grounding',
        JSON.stringify({
          status: 'success',
          resolutionMode: 'automatic_progress',
          dicePolicy: 'no_main_check_for_low_risk_routine_progress',
          success: true,
          appliedToolCallCount: 2,
          appliedToolCalls: [
            { id: 'record_routine_training_progress_1', tool: 'system.npc_state.patch_state' },
            { id: 'record_routine_resource_pickup_2', tool: 'system.npc_state.patch_state' }
          ]
        }, null, 2),
        '',
        '# Context',
        '(no context)'
      ].join('\n')
    }]
  });

  assert.match(result.content, /入门功法/);
  assert.match(result.content, /俸禄/);
  assert.match(result.content, /没有进行掷骰/);
  assert.doesNotMatch(result.content, /门槛|盐线|巡夜人/);
});

test('mock provider does not narrate failed dice grounding as success', async () => {
  const provider = new MockChatProvider();
  const result = await provider.generate({
    messages: [{
      role: 'user',
      content: [
        '# Current Input',
        '我强行冲击筑基境。',
        '',
        '# Raw Input',
        '我强行冲击筑基境。',
        '',
        '# Resolver Grounding',
        JSON.stringify({
          status: 'success',
          success: false,
          diceRolled: true,
          diceResults: [
            { checkId: 'main_check', outcome: 'failure', success: false, total: 8, threshold: 20 }
          ]
        }, null, 2)
      ].join('\n')
    }]
  });

  assert.match(result.content, /未达到成功条件|没有按成功结果写入/);
  assert.doesNotMatch(result.content, /直接推进|局面已经变化/);
});

test('mock provider narrates successful state-change grounding from current action', async () => {
  const provider = new MockChatProvider();
  const result = await provider.generate({
    messages: [{
      role: 'user',
      content: [
        '# Current Input',
        '我在青岚镇酒馆听到传闻：黑雾井下有失踪矿工和一枚玄铁钥匙。我立刻接下调查黑雾井的委托；在酒馆遇见新NPC铁匠韩铸，他把玄铁钥匙交给我，请我去新地图黑雾井底。青狐帮和云岚宗的关系从中立转为紧张。灵脉污染指数目前为37。',
        '',
        '# Raw Input',
        '我在青岚镇酒馆听到传闻：黑雾井下有失踪矿工和一枚玄铁钥匙。我立刻接下调查黑雾井的委托；在酒馆遇见新NPC铁匠韩铸，他把玄铁钥匙交给我，请我去新地图黑雾井底。青狐帮和云岚宗的关系从中立转为紧张。灵脉污染指数目前为37。',
        '',
        '# Resolver Grounding',
        JSON.stringify({
          status: 'success',
          success: true,
          resolutionMode: 'explicit_world_fact_updates',
          appliedToolCallCount: 7,
          diceRolled: true,
          diceResults: [
            { checkId: 'main_check', outcome: 'success', success: true, total: 18, threshold: 13 }
          ]
        }, null, 2)
      ].join('\n')
    }]
  });

  assert.match(result.content, /黑雾井|韩铸|玄铁钥匙|灵脉污染指数/);
  assert.match(result.content, /7 项状态或设定写入/);
  assert.doesNotMatch(result.content, /盐线|黑蜡|梅尔|巡夜|物品「闻：|但青狐帮/);
});

test('mock provider narrates frontend-typable English state-change grounding', async () => {
  const provider = new MockChatProvider();
  const action = [
    'FRONTEND E2E',
    'location Qilan Tavern END',
    'accept quest Investigate Mist Mine END',
    'new NPC Hunter Shen Tuo END',
    'new item Star Sigil Token END',
    'new map Mist Mine END',
    'faction Red Snake Gang and faction Azure Sect relation tense END',
    'metric Mine Danger Index 58 source Deep Fog END'
  ].join(' ');
  const result = await provider.generate({
    messages: [{
      role: 'user',
      content: [
        '# Current Input',
        action,
        '',
        '# Raw Input',
        action,
        '',
        '# Resolver Grounding',
        JSON.stringify({
          status: 'success',
          success: true,
          resolutionMode: 'explicit_world_fact_updates',
          appliedToolCallCount: 15,
          diceRolled: true
        }, null, 2)
      ].join('\n')
    }]
  });

  assert.match(result.content, /Investigate Mist Mine|Hunter Shen Tuo|Star Sigil Token|Mist Mine|Red Snake Gang|Azure Sect|Mine Danger Index=58/);
  assert.match(result.content, /15 项状态或设定写入/);
});

test('mock provider narrates prepared combat as battle UI handoff', async () => {
  const provider = new MockChatProvider();
  const result = await provider.generate({
    messages: [{
      role: 'user',
      content: [
        '# Current Input',
        '我去猎杀两只低级魔兽。',
        '',
        '# Raw Input',
        '我去猎杀两只低级魔兽。',
        '',
        '# Resolver Grounding',
        JSON.stringify({
          status: 'prepared',
          success: false,
          diceRolled: false
        }, null, 2)
      ].join('\n')
    }]
  });

  assert.match(result.content, /战斗已进入独立战斗界面/);
  assert.doesNotMatch(result.content, /直接推进/);
});
