// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NPC_RELATIONSHIP_PLUGIN,
  NpcRelationshipGraph,
  SQLiteDataManager,
  ToolPluginManager,
  createNpcRelationshipHandlers
} from '../src/index.js';

test('npc relationship graph imports, exports, traverses recursively, and finds paths', () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const graph = new NpcRelationshipGraph({ dataManager });

  const imported = graph.importDocument({
    format: 'yaml',
    text: [
      'npcRelationshipGraph:',
      '  nodes:',
      '    - npcId: npc_mira',
      '      name: Mira',
      '      tags: [mage]',
      '    - npcId: npc_guard',
      '      name: Gate Guard',
      '      tags: [guard]',
      '    - npcId: npc_baron',
      '      name: Baron Vale',
      '      tags: [noble]',
      '  edges:',
      '    - fromNpcId: npc_mira',
      '      toNpcId: npc_guard',
      '      relationType: ally',
      '      direction: mutual',
      '      weight: 70',
      '      summary: Mira trusts the guard.',
      '    - fromNpcId: npc_guard',
      '      toNpcId: npc_baron',
      '      relationType: serves',
      '      direction: directed',
      '      weight: 40',
      '      summary: The guard serves Baron Vale.'
    ].join('\n')
  });

  assert.equal(imported.nodes.count, 3);
  assert.equal(imported.edges.count, 2);

  const traversed = graph.traverseRelations({
    startNpcId: 'npc_mira',
    maxDepth: 2,
    includeOutgoing: true,
    includeIncoming: true
  });
  assert.deepEqual(new Set(traversed.nodes.map((node) => node.id)), new Set(['npc_mira', 'npc_guard', 'npc_baron']));
  assert.equal(traversed.paths.some((path) => path.toNpcId === 'npc_baron' && path.depth === 2), true);

  const path = graph.findPath({
    startNpcId: 'npc_mira',
    targetNpcId: 'npc_baron',
    maxDepth: 3
  });
  assert.equal(path.found, true);
  assert.deepEqual(path.pathNpcIds, ['npc_mira', 'npc_guard', 'npc_baron']);

  const exported = graph.exportDocument({ format: 'json' });
  assert.match(exported.text, /npc_baron/);
  assert.equal(exported.payload.npcRelationshipGraph.edges.length, 2);

  dataManager.close();
});

test('npc relationship graph tools allow agent CRUD and recursive queries', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const graph = new NpcRelationshipGraph({ dataManager });
  const manager = new ToolPluginManager({ trace: false });
  manager.createPlugin(NPC_RELATIONSHIP_PLUGIN, {
    handlers: createNpcRelationshipHandlers({ graph })
  });

  const node = await manager.executeTool('system.npc_relationships.upsert_node', {
    npcId: 'npc_a',
    name: 'NPC A',
    tags: ['test']
  });
  assert.equal(node.output.id, 'npc_a');

  await manager.executeTool('system.npc_relationships.upsert_edge', {
    fromNpcId: 'npc_a',
    toNpcId: 'npc_b',
    relationType: 'knows',
    direction: 'undirected',
    weight: 10
  });
  const edge = await manager.executeTool('system.npc_relationships.upsert_edge', {
    fromNpcId: 'npc_b',
    toNpcId: 'npc_c',
    relationType: 'enemy',
    direction: 'undirected',
    weight: 80
  });

  const patched = await manager.executeTool('system.npc_relationships.patch_edge', {
    id: edge.output.id,
    patch: {
      relationType: 'rival',
      summary: 'B and C compete for the same patron.'
    }
  });
  assert.equal(patched.output.data.relationType, 'rival');

  const listed = await manager.executeTool('system.npc_relationships.list_edges', {
    npcId: 'npc_b'
  });
  assert.equal(listed.output.records.length, 2);

  const traversed = await manager.executeTool('system.npc_relationships.traverse_relations', {
    startNpcId: 'npc_a',
    maxDepth: 2
  });
  assert.equal(traversed.output.nodes.some((candidate) => candidate.id === 'npc_c'), true);

  const found = await manager.executeTool('system.npc_relationships.find_path', {
    startNpcId: 'npc_a',
    targetNpcId: 'npc_c',
    maxDepth: 2
  });
  assert.equal(found.output.found, true);
  assert.deepEqual(found.output.pathNpcIds, ['npc_a', 'npc_b', 'npc_c']);

  const deletedNode = await manager.executeTool('system.npc_relationships.delete_node', {
    npcId: 'npc_b'
  });
  assert.equal(deletedNode.output.deleted, true);
  assert.equal(deletedNode.output.deletedEdges.length, 2);

  const remainingEdges = await manager.executeTool('system.npc_relationships.list_edges', {});
  assert.equal(remainingEdges.output.records.length, 0);

  dataManager.close();
});
