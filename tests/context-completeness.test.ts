// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppDatabase,
  RagService,
  SQLiteDataManager,
  createDefaultToolPluginManager
} from '../src/index.js';

function createTestWorld() {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-context-completeness-'));
  const appDatabase = new AppDatabase({
    databasePath: ':memory:',
    chatDataDirectory: join(directory, 'chat-data')
  });
  const dataManager = new SQLiteDataManager({
    databasePath: ':memory:',
    schemaDirectory: null
  });
  const runtimeRagService = new RagService({
    defaultCollection: 'runtime-default',
    chunkSize: 80,
    overlap: 10
  });
  const permanentRagService = new RagService({
    defaultCollection: 'permanent-default',
    chunkSize: 80,
    overlap: 10
  });
  const character = appDatabase.importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Completeness GM',
      first_mes: 'Begin.'
    }
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Completeness Test',
    includeGreeting: false
  }).session;
  const tools = createDefaultToolPluginManager({
    appDatabase,
    dataManager,
    ragService: runtimeRagService,
    permanentRagService,
    trace: {
      enabled: false
    }
  });
  return {
    directory,
    appDatabase,
    dataManager,
    runtimeRagService,
    permanentRagService,
    character,
    chat,
    tools
  };
}

async function seedNpcContext(world) {
  await world.tools.executeTool('system.npc_registry.upsert_npc', {
    id: 'npc_mira',
    name: '米拉',
    role: '银钥匙委托人',
    importance: 'major',
    summary: 'L0: 米拉是旧市场银钥匙线索的委托人。'
  }, undefined, {
    authorization: true
  });
  await world.tools.executeTool('system.scene_npcs.mount_npc', {
    chatSessionId: world.chat.id,
    sceneId: 'old_market',
    npcId: 'npc_mira',
    status: 'present'
  });
  await world.tools.executeTool('system.npc_profiles.upsert_profile', {
    npcId: 'npc_mira',
    level: 'L1',
    name: '米拉',
    summary: 'L1: 米拉谨慎、焦急，正在寻找银钥匙。'
  }, undefined, {
    authorization: true
  });
  await world.tools.executeTool('system.npc_profiles.upsert_profile', {
    npcId: 'npc_mira',
    level: 'L2',
    name: '米拉',
    sections: {
      motive: '她害怕男爵发现钟楼密门。',
      loyalty: '她更忠于旧市场居民，而不是男爵。'
    }
  }, undefined, {
    authorization: true
  });
  await world.permanentRagService.ingestText({
    collection: 'lore',
    sourceId: 'mira-secret',
    text: '米拉知道旧市场钟楼下有密门。她担心男爵巡逻队会抢先找到银钥匙。'
  });
}

test('context completeness assesses layer needs and resolves L0/L1/L2 plus RAG', async () => {
  const world = createTestWorld();
  try {
    await seedNpcContext(world);

    const described = await world.tools.executeTool('system.context_completeness.describe_policy', {});
    assert.equal(described.output.noLlm, true);
    assert.match(described.output.ragGapStrategy, /gap probe/);

    const assessed = await world.tools.executeTool('system.context_completeness.assess_need', {
      query: '我想说服米拉背叛男爵，帮我打开钟楼密门。',
      intent: 'persuasion',
      actorIds: ['npc_mira'],
      riskHint: 'high'
    });
    assert.deepEqual(assessed.output.requiredLevels, ['L0', 'L1', 'L2']);
    assert.ok(assessed.output.requiredSources.includes('rag'));
    assert.ok(assessed.output.requiredSources.includes('relationships'));

    const resolved = await world.tools.executeTool('system.context_completeness.resolve_context', {
      chatSessionId: world.chat.id,
      sceneId: 'old_market',
      query: '说服米拉背叛男爵，打开钟楼密门',
      intent: 'persuasion',
      actorIds: ['npc_mira'],
      riskHint: 'high',
      permanentRagCollection: 'lore',
      minScore: 0,
      maxContextTokens: 3000
    });

    const mira = resolved.output.actorContext.npc_mira;
    assert.deepEqual(mira.loadedLevels, ['L0', 'L1', 'L2']);
    assert.equal(mira.sufficiency, 'enough');
    assert.equal(resolved.output.rag.searched, true);
    assert.equal(resolved.output.rag.totalHits > 0, true);
    assert.match(resolved.output.promptContext, /AI_DND_CONTEXT/);
    assert.match(resolved.output.contextPackage, /Missing Awareness/);
    assert.match(resolved.output.missingAwareness.promptHint, /do not silently invent/);
    assert.equal(resolved.output.usage.databaseCallCount, resolved.output.toolCalls.length);
    assert.equal(resolved.output.debug.databaseCallCounts.byImportance.L0.ok, 1);
    assert.equal(resolved.output.debug.databaseCallCounts.byImportance.L1.ok, 1);
    assert.equal(resolved.output.debug.databaseCallCounts.byImportance.L2.ok, 1);
    assert.equal(resolved.output.debug.databaseCallCounts.byImportance.RAG.ok, 2);
    assert.equal(resolved.output.debug.databaseCallCounts.byActor.npc_mira.byImportance.L0.ok, 1);
  } finally {
    world.appDatabase.close();
    world.dataManager.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});

test('context completeness reports missing high-stakes L3 and loop uses it in context phase', async () => {
  const world = createTestWorld();
  try {
    await seedNpcContext(world);

    const resolved = await world.tools.executeTool('system.context_completeness.resolve_context', {
      chatSessionId: world.chat.id,
      sceneId: 'old_market',
      query: '永久改变米拉的命运，让她背叛男爵。',
      intent: 'npc_behavior',
      actorIds: ['npc_mira'],
      riskHint: 'permanent',
      permanentRagCollection: 'lore',
      minScore: 0
    });
    assert.equal(resolved.output.sufficiency, 'insufficient');
    assert.ok(resolved.output.actorContext.npc_mira.missingLevels.includes('L3'));
    assert.ok(resolved.output.nextRetrievalActions.some((action) => action.missing === 'L3'));
    assert.equal(resolved.output.debug.databaseCallCounts.byImportance.L3.ok, 1);
    assert.equal(resolved.output.debug.databaseCallCounts.byImportance.L3.empty, 1);

    const dryRun = await world.tools.executeTool('system.agent_loop.dry_run_turn', {
      chatSessionId: world.chat.id,
      sceneId: 'old_market',
      text: '我说服米拉背叛男爵。',
      maxContextTokens: 1600,
      contextPlannerInput: {
        includeRecentMessages: false
      }
    });
    const contextPhase = dryRun.output.phases.find((phase) => phase.phaseId === 'context.budget').output;
    assert.equal(contextPhase.toolId, 'system.context_completeness.resolve_context');
    assert.equal(contextPhase.output.policy.ragGapStrategy.includes('gap probe'), true);
  } finally {
    world.appDatabase.close();
    world.dataManager.close();
    rmSync(world.directory, { recursive: true, force: true });
  }
});
