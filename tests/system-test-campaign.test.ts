// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  AgentChatRuntime,
  AppDatabase,
  MockChatProvider,
  RagService,
  SQLiteDataManager
} from '../src/index.js';

const ROOT = process.cwd();
const CARD_PATH = resolve(ROOT, 'examples/characters/system-test-campaign.card.json');
const RESOURCES_PATH = resolve(ROOT, 'examples/characters/system-test-campaign.resources.json');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function createCampaignWorld() {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-system-test-campaign-'));
  const appDatabase = new AppDatabase({
    databasePath: ':memory:',
    chatDataDirectory: join(directory, 'chat-data')
  });
  const dataManager = new SQLiteDataManager({
    databasePath: ':memory:',
    schemaDirectory: null
  });
  const runtime = new AgentChatRuntime({
    chatProvider: new MockChatProvider(),
    appDatabase,
    dataManager,
    ragService: new RagService({
      defaultCollection: 'system-test-runtime',
      chunkSize: 180,
      overlap: 30
    }),
    worldline: {
      databasePath: ':memory:',
      trace: false
    },
    scene: false,
    toolTrace: false
  });
  return {
    directory,
    appDatabase,
    dataManager,
    runtime
  };
}

function cleanupWorld(world) {
  world.appDatabase.close();
  world.dataManager.close();
  rmSync(world.directory, { recursive: true, force: true });
}

async function send(world, chatId, content, options = {}) {
  const result = await world.runtime.sendAppChatMessage(chatId, content, {
    source: 'test.system-test-campaign',
    ...options
  });
  const reply = result.assistantMessage?.content || '';
  assert.notEqual(reply.trim(), '', `empty reply for ${content}`);
  assert.doesNotMatch(reply, /# Current Input|# Resolver Grounding|systemPrompt|promptTemplate/i);
  return result;
}

function finalLoop(result = {}) {
  return result.agentLoop?.finalOutput || result.agentLoop || {};
}

function resolverToolIds(result = {}) {
  return (finalLoop(result).resolverCandidates || []).map((candidate) => candidate.toolId);
}

function routedIntentIds(result = {}) {
  const intent = finalLoop(result).intent || {};
  return [
    intent.intent,
    ...(Array.isArray(intent.orderedIntents) ? intent.orderedIntents.map((entry) => entry.intent) : [])
  ].filter(Boolean);
}

function phaseOutput(result = {}, phaseId) {
  return (finalLoop(result).phases || []).find((phase) => phase.phaseId === phaseId)?.output || {};
}

function adjudicationAppliedToolIds(result = {}) {
  return phaseOutput(result, 'adjudication')
    .resolverResult?.currentResolution?.apply?.appliedToolCalls
    ?.map((call) => call.tool) || [];
}

async function listNpcStates(world, chatId, input = {}) {
  return (await world.runtime.executeTool('system.npc_state.list_states', {
    chatSessionId: chatId,
    limit: 100,
    ...input
  })).output.records;
}

async function setFixedDie(world, diceSides, value) {
  const result = await world.runtime.executeTool('game.dice.remote_control', {
    action: 'set',
    diceSides,
    fixedRoll: value,
    reason: 'system test campaign deterministic check'
  }, {
    authorization: true
  });
  assert.equal(result.output.status, 'set');
  assert.equal(result.output.config.fixedRoll, value);
}

test('system test campaign imports enough world data and supports player-perspective core flows', async () => {
  const world = createCampaignWorld();
  try {
    const imported = await world.runtime.importAppCharacterBundle({
      characterCard: readJson(CARD_PATH),
      sidecar: readJson(RESOURCES_PATH)
    }, {
      source: 'test.system-test-campaign'
    });
    assert.equal(imported.character.name, '系统测试GM - 灰港回路');
    assert.equal(imported.resources.globalData.importedCollections.length >= 7, true);
    assert.equal(imported.resources.runtimeRag.importedCollections.length, 1);

    const created = await world.runtime.createAppChatSession({
      characterCardId: imported.character.id,
      title: '灰港回路玩家视角验收',
      userName: '测试玩家',
      includeGreeting: true
    });
    const chatId = created.session.id;
    assert.equal(created.initialization.status, 'bound');
    assert.equal(created.initialization.actorId, 'pc_cenyi');
    assert.equal(created.greeting.status, 'created');
    assert.match(created.session.messages[0].content, /油布地图/);

    const npcStates = await listNpcStates(world, chatId);
    assert.equal(npcStates.length >= 6, true);
    assert.equal(npcStates.some((record) => record.data.npcId === 'npc_yanchao'), true);
    assert.equal(npcStates.some((record) => record.data.npcId === 'npc_mist_wraith'), true);
    const protagonist = npcStates.find((record) => record.data.npcId === 'pc_cenyi');
    assert.ok(protagonist);
    assert.equal(protagonist.data.inventory.items.some((item) => item.name === '盐灯芯'), true);
    assert.equal(protagonist.data.skillBar.skills.some((skill) => skill.name === '路线判断'), true);

    const referenceTexts = world.appDatabase.queryChatDataRecords(chatId, 'reference_texts', {
      limit: 20
    });
    assert.equal(referenceTexts.records.length >= 5, true);
    assert.equal(referenceTexts.records.some((record) => /战斗量尺/u.test(record.data.title)), true);

    const path = await world.runtime.executeTool('system.map_relationships.find_scene_path', {
      chatSessionId: chatId,
      startMapId: 'map_gray_market',
      targetMapId: 'map_blacktide_pier',
      includeGlobal: true,
      includeBlocked: false
    });
    assert.equal(path.output.found, true);
    assert.equal(path.output.pathMapIds.includes('map_salt_warehouse'), true);
    assert.equal(path.output.pathMapIds.includes('map_blacktide_pier'), true);
    assert.equal(path.output.pathEdgeIds.includes('edge_bridge_pier'), false);

    const factions = await world.runtime.executeTool('system.factions.list_factions', {
      query: '潮帮',
      limit: 10
    });
    assert.equal(factions.output.records.some((record) => record.data.factionId === 'faction_tide_gang'), true);
    const npcRelations = await world.runtime.executeTool('system.npc_relationships.list_edges', {
      limit: 20
    });
    assert.equal(npcRelations.output.records.some((record) => record.data.toNpcId === 'npc_yanchao' || record.data.fromNpcId === 'npc_yanchao'), true);
    const ragHits = await world.runtime.retrieveMemory({
      collection: 'system-test-gray-harbor',
      query: '阎潮 雾灯芯 黑潮码头',
      limit: 5,
      minScore: 0
    });
    assert.equal(ragHits.some((hit) => /阎潮/u.test(hit.text)), true);

    const observe = await send(world, chatId, '我观察灰港市场、盐仓灰脚印和钟桥暗哨。');
    assert.equal(routedIntentIds(observe).includes('observation'), true);
    assert.equal(resolverToolIds(observe).includes('system.action.resolve'), true);
    assert.match(observe.assistantMessage.content, /检定|行动结果|旁白|灰港/u);

    const move = await send(world, chatId, '我根据油布地图移动到旧盐仓，避开钟桥。', {
      startMapId: 'map_gray_market',
      targetMapId: 'map_salt_warehouse',
      includeGlobal: true,
      includeBlocked: false
    });
    assert.equal(routedIntentIds(move).includes('movement'), true);
    assert.equal(resolverToolIds(move).includes('system.map_relationships.find_scene_path'), true);

    const social = await send(world, chatId, '我说服梁科放我通过钟桥，并展示巡查威信和盐仓灰线索。');
    assert.equal(routedIntentIds(social).includes('social_action'), true);
    assert.equal(resolverToolIds(social).includes('system.persuasion.resolve'), true);

    await setFixedDie(world, 20, 20);
    const dynamicSchema = await send(
      world,
      chatId,
      '请记录一个自定义扩展数据：雾潮污染指数目前为37，污染源描述为盐仓雾魇。'
    );
    assert.equal(resolverToolIds(dynamicSchema).includes('system.action.resolve'), true);
    assert.equal(adjudicationAppliedToolIds(dynamicSchema).includes('system.data.quantify_text'), true);
    const collections = await world.runtime.executeTool('system.data.list_collections', {});
    assert.equal(collections.output.collections.includes('story_metrics'), true);
    const metrics = await world.runtime.executeTool('system.data.query_fields', {
      collection: 'story_metrics',
      fields: ['metricName', 'value', 'sourceDescription'],
      limit: 20
    });
    assert.equal(metrics.output.records.some((record) => (
      record.fields.metricName === '雾潮污染指数'
      && record.fields.value === 37
      && record.fields.sourceDescription === '盐仓雾魇'
    )), true);
    const dynamicGrounding = phaseOutput(dynamicSchema, 'narrative.render').resolverGrounding;
    assert.equal(dynamicGrounding.writtenFacts.extensionFacts.some((fact) => (
      fact.name === '雾潮污染指数' && fact.value === 37
    )), true);

    const combat = await send(world, chatId, '旧盐仓里雾魇扑来，我拔短刃攻击雾魇。');
    assert.equal(routedIntentIds(combat).includes('combat_action'), true);
    assert.equal(resolverToolIds(combat).includes('system.combat.prepare_battle'), true);

    const itemUse = await send(world, chatId, '我使用盐灯芯削弱雾魇，并把证物装进证物袋。');
    assert.equal(resolverToolIds(itemUse).includes('system.action.resolve'), true);
    const adjudication = phaseOutput(itemUse, 'adjudication');
    assert.ok(adjudication.resolverResult);

    const finalChat = world.appDatabase.getChatSession(chatId, {
      includeMessages: true,
      includeCharacter: false,
      includeDataDatabase: false
    });
    assert.equal(finalChat.messages.length >= 11, true);
  } finally {
    cleanupWorld(world);
  }
});
