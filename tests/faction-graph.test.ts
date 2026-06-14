// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FactionGraph,
  RagService,
  SQLiteDataManager,
  createDefaultToolPluginManager
} from '../src/index.js';

test('faction graph imports factions, complex relations, memberships, and builds rag documents', () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const graph = new FactionGraph({ dataManager });

  try {
    const imported = graph.importDocument({
      format: 'yaml',
      text: [
        'factionGraph:',
        '  factions:',
        '    - factionId: city_watch',
        '      name: City Watch',
        '      kind: guard',
        '      scale: local',
        '      coreInterests: [order, taxes, reputation]',
        '    - factionId: silver_cult',
        '      name: Silver Cult',
        '      kind: cult',
        '      scale: cell',
        '      coreInterests: [secrecy, sacrifice]',
        '    - factionId: harbor_guild',
        '      name: Harbor Guild',
        '      kind: guild',
        '      scale: local',
        '  relations:',
        '    - fromFactionId: city_watch',
        '      toFactionId: silver_cult',
        '      relationType: mixed',
        '      weight: -70',
        '      aspects:',
        '        - id: public_crackdown',
        '          type: opposition',
        '          summary: The watch publicly hunts cult cells.',
        '        - id: informant_trade',
        '          type: covert_cooperation',
        '          summary: Individual officers sometimes trade information with cult defectors.',
        '      sharedInterests:',
        '        - Keeping planar panic out of public view.',
        '      conflictingInterests:',
        '        - Law enforcement versus sacrifice rites.',
        '      coreConflict: The cult undermines public order.',
        '    - fromFactionId: harbor_guild',
        '      toFactionId: city_watch',
        '      relationType: overlaps',
        '      direction: undirected',
        '      weight: 20',
        '  memberships:',
        '    - actorId: npc_guard',
        '      actorName: Gate Guard',
        '      factionId: city_watch',
        '      role: gate sentry',
        '      loyalty: 65',
        '      reasons: [salary, oath]'
      ].join('\n')
    });

    assert.equal(imported.factions.count, 3);
    assert.equal(imported.relations.count, 2);
    assert.equal(imported.memberships.count, 1);
    assert.equal(imported.relations.records[0].data.aspects.length, 2);
    assert.equal(imported.relations.records[0].data.sharedInterests[0], 'Keeping planar panic out of public view.');

    const actorFactions = graph.getActorFactions({ actorId: 'npc_guard' });
    assert.equal(actorFactions.factions[0].faction.id, 'city_watch');
    assert.equal(actorFactions.factions[0].membership.data.role, 'gate sentry');

    const path = graph.findRelationPath({
      startFactionId: 'harbor_guild',
      targetFactionId: 'silver_cult',
      maxDepth: 3
    });
    assert.equal(path.found, true);
    assert.deepEqual(path.pathFactionIds, ['harbor_guild', 'city_watch', 'silver_cult']);

    const rag = graph.buildRagDocuments({ factionId: 'city_watch' });
    assert.equal(rag.documents.some((document) => document.metadata.kind === 'faction'), true);
    assert.equal(rag.documents.some((document) => document.text.includes('Gate Guard')), true);
    assert.equal(rag.documents.some((document) => document.text.includes('covert_cooperation')), true);

    const exported = graph.exportDocument({ format: 'json' });
    assert.match(exported.text, /silver_cult/);
  } finally {
    dataManager.close();
  }
});

test('faction relation shifts keep qualitative strategy history separate from numeric hints', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const manager = createDefaultToolPluginManager({
    dataManager,
    trace: false
  });

  try {
    await manager.executeTool('system.factions.upsert_relation', {
      id: 'watch_guild_mixed',
      fromFactionId: 'city_watch',
      toFactionId: 'harbor_guild',
      relationType: 'mixed',
      trust: 20,
      tension: 15,
      aspects: [
        { id: 'dock_security', type: 'cooperation', summary: 'They cooperate on dock security.' },
        { id: 'bribe_rivalry', type: 'opposition', summary: 'They fight over bribe networks.' }
      ],
      decisionNotes: 'Do not reduce this relation to trust minus tension.'
    });

    const planned = await manager.executeTool('system.factions.plan_relation_shift', {
      relationId: 'watch_guild_mixed',
      eventType: 'poach_members',
      tactic: '挖墙脚',
      eventText: 'The Harbor Guild offers protection money to turn two exhausted watch sergeants.',
      relationDeltas: {
        trust: -4,
        tension: 6
      }
    });
    assert.equal(planned.output.patch.trust, 16);
    assert.equal(planned.output.patch.tension, 21);
    assert.equal(planned.output.patch.activeStrategies.some((item) => item.id === 'poach_members'), true);
    assert.equal(planned.output.guidance.some((line) => line.includes('reference hints')), true);

    const dryRun = await manager.executeTool('system.factions.apply_relation_shift', {
      plan: planned.output
    });
    assert.equal(dryRun.output.status, 'dry_run');
    const unchanged = await manager.executeTool('system.factions.get_relation', {
      id: 'watch_guild_mixed'
    });
    assert.equal(unchanged.output.data.tension, 15);

    const applied = await manager.executeTool('system.factions.apply_relation_shift', {
      plan: planned.output,
      dryRun: false
    });
    assert.equal(applied.output.applied.data.tension, 21);
    assert.equal(applied.output.applied.data.aspects.some((item) => item.id === 'dock_security'), true);
    assert.equal(applied.output.applied.data.aspects.some((item) => item.id === 'poach_members'), true);
    assert.equal(applied.output.applied.data.changeLog.length, 1);
    assert.equal(applied.output.applied.data.metadata.relationShiftLog.length, 1);

    const mutual = await manager.executeTool('system.factions.apply_relation_shift', {
      relationId: 'watch_guild_mixed',
      eventType: '唇寒齿亡',
      eventText: 'If the Harbor Guild collapses, pirate crews will overrun the docks before the Watch can respond.',
      dryRun: false
    });
    assert.equal(mutual.output.applied.data.dependencies.some((item) => item.id === 'lips_teeth_dependency'), true);
    assert.equal(mutual.output.applied.data.activeStrategies.some((item) => item.id === 'conditional_support'), true);
  } finally {
    dataManager.close();
  }
});

test('faction tools allow agent CRUD and runtime rag indexing', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const runtimeRagService = new RagService({ defaultCollection: 'runtime-factions' });
  const manager = createDefaultToolPluginManager({
    dataManager,
    ragService: runtimeRagService,
    trace: false
  });

  try {
    const faction = await manager.executeTool('system.factions.upsert_faction', {
      factionId: 'moon_court',
      name: 'Moon Court',
      coreInterests: ['omens', 'legitimacy'],
      summary: 'A court faction that trades in prophecy.'
    });
    assert.equal(faction.output.id, 'moon_court');

    await manager.executeTool('system.factions.upsert_membership', {
      actorId: 'npc_oracle',
      actorName: 'Oracle',
      factionId: 'moon_court',
      role: 'seer',
      loyalty: 80,
      reasons: ['shared visions']
    });

    const membership = await manager.executeTool('system.factions.get_actor_factions', {
      actorId: 'npc_oracle'
    });
    assert.equal(membership.output.factions[0].faction.data.name, 'Moon Court');

    const indexed = await manager.executeTool('system.factions.remember_runtime_rag', {
      collection: 'runtime-factions',
      factionId: 'moon_court'
    });
    assert.equal(indexed.output.sourceDocuments >= 2, true);

    const searched = await manager.executeTool('system.factions.search_rag', {
      layer: 'runtime',
      runtimeCollection: 'runtime-factions',
      query: 'prophecy oracle',
      limit: 3,
      minScore: 0
    });
    assert.equal(searched.output.runtime.length > 0, true);
  } finally {
    dataManager.close();
  }
});

test('faction actor influence tool plans and applies important NPC reverse impact', async () => {
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const manager = createDefaultToolPluginManager({
    dataManager,
    trace: false
  });

  try {
    await manager.executeTool('system.factions.upsert_faction', {
      factionId: 'city_watch',
      name: 'City Watch',
      values: {
        reputation: 10,
        stability: 8,
        morale: 5,
        alertLevel: 0
      }
    });
    await manager.executeTool('system.factions.upsert_faction', {
      factionId: 'silver_cult',
      name: 'Silver Cult'
    });
    await manager.executeTool('system.factions.upsert_relation', {
      id: 'watch_vs_cult',
      fromFactionId: 'city_watch',
      toFactionId: 'silver_cult',
      relationType: 'enemy',
      tension: 20,
      weight: -50
    });
    await manager.executeTool('system.factions.upsert_membership', {
      actorId: 'npc_captain',
      actorName: 'Captain Ilyra',
      factionId: 'city_watch',
      role: 'captain',
      loyalty: 75,
      influence: 9
    });

    const planned = await manager.executeTool('system.factions.plan_actor_influence', {
      actorId: 'npc_captain',
      actorName: 'Captain Ilyra',
      impactType: 'scandal',
      magnitude: 4,
      eventText: 'Captain Ilyra was exposed taking bribes at the north gate.',
      evidence: 'witness testimony',
      propagateRelations: true,
      relationDeltas: {
        tension: 3
      }
    });
    assert.equal(planned.output.factionPatches[0].afterPreview.values.reputation, 6);
    assert.equal(planned.output.membershipPatches[0].afterPreview.influence, 7);
    assert.equal(planned.output.relationPatches[0].afterPreview.tension, 23);

    const dryRun = await manager.executeTool('system.factions.apply_actor_influence', {
      plan: planned.output
    });
    assert.equal(dryRun.output.status, 'dry_run');
    const unchanged = await manager.executeTool('system.factions.get_faction', {
      factionId: 'city_watch'
    });
    assert.equal(unchanged.output.data.values.reputation, 10);

    const applied = await manager.executeTool('system.factions.apply_actor_influence', {
      plan: planned.output,
      dryRun: false
    });
    assert.equal(applied.output.status, 'applied');
    assert.equal(applied.output.applied.factions[0].data.values.reputation, 6);
    assert.equal(applied.output.applied.factions[0].data.metadata.actorInfluenceLog.length, 1);
    assert.equal(applied.output.applied.memberships[0].data.influence, 7);
    assert.equal(applied.output.applied.relations[0].data.tension, 23);
  } finally {
    dataManager.close();
  }
});
