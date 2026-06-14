// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppDatabase,
  RagLayerManager,
  RagService,
  SQLiteDataManager,
  SQLiteVectorStore,
  ToolPluginManager,
  RAG_PERMANENT_PLUGIN,
  RAG_RUNTIME_PLUGIN,
  createDefaultToolPluginManager,
  createRagPermanentHandlers,
  createRagRuntimeHandlers
} from '../src/index.js';

function createPermanentRag(directory) {
  const vectorStore = new SQLiteVectorStore({
    databasePath: join(directory, 'permanent-rag.sqlite')
  });
  return {
    vectorStore,
    ragService: new RagService({
      vectorStore,
      defaultCollection: 'permanent-default',
      chunkSize: 80,
      overlap: 10
    })
  };
}

test('permanent rag imports files only with user authorization and exposes search to agent', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-rag-permanent-'));
  const { vectorStore, ragService } = createPermanentRag(directory);
  const ragLayers = new RagLayerManager({ permanentRagService: ragService });
  const manager = new ToolPluginManager({ trace: false });
  manager.createPlugin(RAG_PERMANENT_PLUGIN, {
    handlers: createRagPermanentHandlers({ ragLayers })
  });

  try {
    await assert.rejects(
      manager.executeTool('system.rag_permanent.import_file', {
        collection: 'lore',
        sourceId: 'bell-tower',
        text: '钟楼地下有银钥匙。'
      }),
      /requires explicit user authorization/
    );

    const imported = await manager.executeTool('system.rag_permanent.import_file', {
      collection: 'lore',
      sourceId: 'bell-tower',
      text: '钟楼地下有银钥匙。男爵不知道这条密道。',
      filename: 'lore.md'
    }, undefined, {
      authorization: true
    });
    assert.equal(imported.output.importedChunks, 1);

    const searched = await manager.executeTool('system.rag_permanent.search', {
      collection: 'lore',
      query: '银钥匙在哪里',
      minScore: 0
    });
    assert.ok(searched.output.hits.length > 0);
    assert.match(searched.output.hits[0].text, /银钥匙/);

    await assert.rejects(
      manager.executeTool('system.rag_permanent.export_collection', {
        collection: 'lore'
      }),
      /requires explicit user authorization/
    );

    const exported = await manager.executeTool('system.rag_permanent.export_collection', {
      collection: 'lore',
      format: 'json'
    }, undefined, {
      authorization: true
    });
    assert.equal(exported.output.payload.documents.length, 1);
    assert.match(exported.output.text, /bell-tower/);
  } finally {
    vectorStore.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('permanent rag can import global data manager records as a database snapshot', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-rag-db-'));
  const dataManager = new SQLiteDataManager({
    databasePath: join(directory, 'data.sqlite'),
    schemaDirectory: join(directory, 'schemas')
  });
  const { vectorStore, ragService } = createPermanentRag(directory);
  const ragLayers = new RagLayerManager({
    permanentRagService: ragService,
    dataManager
  });

  try {
    dataManager.upsertRecord('npc_registry', {
      id: 'npc_mira',
      name: '米拉',
      summary: '米拉知道银钥匙在旧市场。'
    }, { id: 'npc_mira' });

    const imported = await ragLayers.importDatabaseSnapshot({
      collection: 'database-lore',
      database: 'global-data',
      sourceCollection: 'npc_registry'
    });
    assert.ok(imported.importedChunks > 0);
    assert.equal(imported.source.collections[0], 'npc_registry');
    assert.equal(imported.documents[0].metadata.sourceCollection, 'npc_registry');
    assert.equal(imported.documents[0].metadata.recordId, 'npc_mira');

    const searched = await ragLayers.searchPermanent({
      collection: 'database-lore',
      query: '谁知道银钥匙',
      minScore: 0
    });
    assert.ok(searched.hits.length > 0);
    assert.match(searched.hits[0].text, /npc_mira|米拉/);
    assert.equal(searched.hits[0].sourceRef.recordId, 'npc_mira');
  } finally {
    dataManager.close();
    vectorStore.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('runtime rag tools reuse the existing in-memory vector store for agent memory', async () => {
  const runtimeRagService = new RagService({
    defaultCollection: 'runtime-default',
    chunkSize: 80,
    overlap: 10
  });
  const ragLayers = new RagLayerManager({ runtimeRagService });
  const manager = new ToolPluginManager({ trace: false });
  manager.createPlugin(RAG_RUNTIME_PLUGIN, {
    handlers: createRagRuntimeHandlers({ ragLayers })
  });

  const remembered = await manager.executeTool('system.rag_runtime.remember', {
    collection: 'scene-memory',
    sourceId: 'runtime-note',
    text: '玩家刚刚发现守卫害怕红色火焰。',
    ttlSeconds: 30,
    importance: 0.8,
    sceneId: 'gate',
    actorIds: ['npc_guard'],
    memoryType: 'observation',
    metadata: { chatSessionId: 'chat-test' }
  });
  assert.equal(remembered.output.importedChunks, 1);
  assert.equal(remembered.output.documents[0].metadata.memoryType, 'observation');
  assert.ok(remembered.output.documents[0].metadata.expiresAt);

  const searched = await manager.executeTool('system.rag_runtime.search', {
    collection: 'scene-memory',
    query: '守卫害怕什么',
    minScore: 0
  });
  assert.ok(searched.output.hits.length > 0);
  assert.match(searched.output.hits[0].text, /红色火焰/);
  assert.equal(searched.output.hits[0].sourceRef.sceneId, 'gate');
});

test('runtime rag prunes expired memories without affecting active memories', async () => {
  const runtimeRagService = new RagService({
    defaultCollection: 'runtime-default',
    chunkSize: 80,
    overlap: 10
  });
  const ragLayers = new RagLayerManager({
    runtimeRagService,
    now: () => '2026-05-30T00:00:00.000Z'
  });

  await ragLayers.rememberRuntime({
    collection: 'scene-memory',
    sourceId: 'expired-note',
    text: '过期记忆：蓝门已经关闭。',
    expiresAt: '2026-05-29T00:00:00.000Z'
  });
  await ragLayers.rememberRuntime({
    collection: 'scene-memory',
    sourceId: 'active-note',
    text: '活跃记忆：红门仍然开启。',
    expiresAt: '2026-06-01T00:00:00.000Z'
  });

  const pruned = await ragLayers.pruneRuntime({ collection: 'scene-memory' });
  assert.equal(pruned.deleted.length, 1);
  assert.equal(pruned.deleted[0].sourceId, 'expired-note');

  const remaining = runtimeRagService.listDocuments({ collection: 'scene-memory' }).documents;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].metadata.sourceId, 'active-note');
});

test('runtime rag maintenance consolidates similar memories and evicts low-priority excess', async () => {
  const runtimeRagService = new RagService({
    defaultCollection: 'runtime-default',
    chunkSize: 120,
    overlap: 10
  });
  const ragLayers = new RagLayerManager({
    runtimeRagService,
    now: () => '2026-05-30T00:00:00.000Z'
  });

  await ragLayers.rememberRuntime({
    collection: 'scene-memory',
    sourceId: 'guard-fire-1',
    text: '守卫害怕红色火焰，看到火把会后退。',
    sceneId: 'gate',
    actorIds: ['npc_guard'],
    memoryType: 'observation',
    importance: 0.8
  });
  await ragLayers.rememberRuntime({
    collection: 'scene-memory',
    sourceId: 'guard-fire-2',
    text: '守卫害怕红色火焰，看到火把会后退。',
    sceneId: 'gate',
    actorIds: ['npc_guard'],
    memoryType: 'observation',
    importance: 0.8
  });
  await ragLayers.rememberRuntime({
    collection: 'scene-memory',
    sourceId: 'minor-note',
    text: '一条不重要的临时闲聊。',
    importance: 0.01
  });

  const maintained = await ragLayers.maintainRuntime({
    collection: 'scene-memory',
    similarityThreshold: 0.85,
    maxDocuments: 1
  });
  assert.equal(maintained.consolidated.merged.length, 1);
  assert.ok(maintained.evicted.deleted.length >= 1);

  const remaining = runtimeRagService.listDocuments({ collection: 'scene-memory' }).documents;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].metadata.sourceKind, 'agent-memory-consolidated');
});

test('default manager registers permanent search and runtime rag when services are provided', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-dnd-rag-default-'));
  const { vectorStore, ragService: permanentRagService } = createPermanentRag(directory);
  const runtimeRagService = new RagService();
  const dataManager = new SQLiteDataManager({
    databasePath: ':memory:',
    schemaDirectory: null
  });
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });

  try {
    const manager = createDefaultToolPluginManager({
      dataManager,
      appDatabase,
      ragService: runtimeRagService,
      permanentRagService,
      trace: false
    });
    const permanentSearch = manager.getTool('system.rag_permanent.search');
    const permanentImport = manager.getTool('system.rag_permanent.import_file');
    const permanentReindex = manager.getTool('system.rag_permanent.reindex_collection');
    const runtimeRemember = manager.getTool('system.rag_runtime.remember');
    const runtimePrune = manager.getTool('system.rag_runtime.prune_expired');
    const runtimeMaintain = manager.getTool('system.rag_runtime.maintain');
    const permanentEvaluate = manager.getTool('system.rag_permanent.evaluate_collection');

    assert.equal(permanentSearch.autoCallable, true);
    assert.equal(permanentSearch.mutatesState, false);
    assert.equal(permanentImport.visibility, 'private');
    assert.equal(permanentImport.metadata.requiresUserAuthorization, true);
    assert.equal(permanentReindex.visibility, 'private');
    assert.equal(permanentReindex.metadata.requiresUserAuthorization, true);
    assert.equal(runtimeRemember.autoCallable, true);
    assert.equal(runtimeRemember.mutatesState, true);
    assert.equal(runtimePrune.autoCallable, true);
    assert.equal(runtimePrune.mutatesState, true);
    assert.equal(runtimeMaintain.autoCallable, true);
    assert.equal(runtimeMaintain.mutatesState, true);
    assert.equal(permanentEvaluate.visibility, 'private');
    assert.equal(permanentEvaluate.metadata.requiresUserAuthorization, true);
  } finally {
    appDatabase.close();
    dataManager.close();
    vectorStore.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
